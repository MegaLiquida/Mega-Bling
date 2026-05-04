import axios, { AxiosRequestConfig } from "axios";
import { BlingAccount } from "../drizzle/schema";
import { updateBlingToken, getNcmFromCache, getNcmFromCacheBySku, upsertNcmCache } from "./db";

const BLING_API = "https://api.bling.com.br/v3";
const BLING_TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const MAX_RETRIES = 3;
const PARALLEL_BATCH_SIZE = 3; // Requisições paralelas simultâneas (conservador para evitar 429)
const BATCH_DELAY_MS = 500; // Delay entre lotes de pedidos

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Semáforo simples para limitar concorrência e respeitar rate limit do Bling
class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly delayMs: number;

  constructor(maxConcurrent: number, delayMs: number) {
    this.maxConcurrent = maxConcurrent;
    this.delayMs = delayMs;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        this.running++;
        try {
          await sleep(this.delayMs);
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.running--;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
          }
        }
      };

      if (this.running < this.maxConcurrent) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }
}

// Rate limiter global: 1 requisição simultânea com 600ms de delay para evitar bloqueio Cloudflare
const globalRateLimiter = new RateLimiter(1, 600); // 1 req simultânea, 600ms de delay para evitar bloqueio Cloudflare

// ─── Rastreamento de bloqueio Cloudflare por conta ───────────────────────────
// Mapa: accountId → timestamp (ms) em que o bloqueio foi detectado
const cloudflareBlockedAt = new Map<number, number>();
const CLOUDFLARE_BLOCK_DURATION_MS = 60 * 60 * 1000; // 60 minutos

export function markAccountBlocked(accountId: number) {
  cloudflareBlockedAt.set(accountId, Date.now());
  console.warn(`[BlingService] Conta ${accountId} marcada como bloqueada pelo Cloudflare às ${new Date().toISOString()}`);
}

export function getAccountBlockStatus(accountId: number): { blocked: boolean; blockedAt: number | null; unblocksAt: number | null; remainingMs: number | null } {
  const blockedAt = cloudflareBlockedAt.get(accountId) ?? null;
  if (!blockedAt) return { blocked: false, blockedAt: null, unblocksAt: null, remainingMs: null };
  const unblocksAt = blockedAt + CLOUDFLARE_BLOCK_DURATION_MS;
  const remainingMs = unblocksAt - Date.now();
  if (remainingMs <= 0) {
    cloudflareBlockedAt.delete(accountId);
    return { blocked: false, blockedAt: null, unblocksAt: null, remainingMs: null };
  }
  return { blocked: true, blockedAt, unblocksAt, remainingMs };
}

export function getAllBlockStatuses(): Map<number, { blockedAt: number; unblocksAt: number; remainingMs: number }> {
  const result = new Map<number, { blockedAt: number; unblocksAt: number; remainingMs: number }>();
  for (const [accountId, blockedAt] of Array.from(cloudflareBlockedAt.entries())) {
    const unblocksAt = blockedAt + CLOUDFLARE_BLOCK_DURATION_MS;
    const remainingMs = unblocksAt - Date.now();
    if (remainingMs > 0) {
      result.set(accountId, { blockedAt, unblocksAt, remainingMs });
    } else {
      cloudflareBlockedAt.delete(accountId);
    }
  }
  return result;
}

// Headers padrão para todas as requisições Bling (evitar bloqueio Cloudflare)
const BLING_DEFAULT_HEADERS = {
  "Accept": "application/json",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
};

async function blingRequest<T>(config: AxiosRequestConfig, retries = MAX_RETRIES): Promise<T> {
  return globalRateLimiter.run(async () => {
    try {
      // Mesclar headers padrão com os headers da requisição
      const mergedConfig = {
        ...config,
        headers: { ...BLING_DEFAULT_HEADERS, ...config.headers },
      };
      const response = await axios(mergedConfig);
      return response.data;
    } catch (err: any) {
      const status = err?.response?.status;

      if (retries > 0 && (status === 429 || status === 503 || status === 502)) {
        const waitMs = Math.pow(2, MAX_RETRIES - retries + 1) * 1000;
        console.warn(`[BlingService] Status ${status} recebido. Aguardando ${waitMs}ms antes de tentar novamente...`);
        await sleep(waitMs);
        return blingRequest<T>(config, retries - 1);
      }

      // 403 = bloqueio Cloudflare ou token inválido — não fazer retry, falhar imediatamente
      if (status === 403) {
        console.warn(`[BlingService] Status 403 recebido (possível bloqueio Cloudflare). Falhando imediatamente sem retry.`);
        // Registrar bloqueio se o accountId foi passado na config
        if ((config as any).__accountId) {
          markAccountBlocked((config as any).__accountId);
        }
        throw new Error(`Bling API error 403: Acesso bloqueado (Cloudflare). Aguarde alguns minutos e tente novamente.`);
      }

      const errorData = err?.response?.data?.error;
      const fields = errorData?.fields ?? [];
      const fieldMessages = fields.map((f: any) => `${f.element ?? "campo"}: ${f.msg}`).join("; ");
      const message = errorData?.description ?? err?.response?.data?.message ?? err.message;
      const fullMessage = fieldMessages ? `${message} | Campos: ${fieldMessages}` : message;
      console.error(`[BlingService] Erro ${status} na URL ${config.url}:`, JSON.stringify(err?.response?.data, null, 2));
      throw new Error(`Bling API error ${status ?? "?"}: ${fullMessage}`);
    }
  });
}

// ─── Token Management ─────────────────────────────────────────────────────────

export async function refreshBlingToken(account: BlingAccount): Promise<string> {
  const credentials = Buffer.from(`${account.clientId}:${account.clientSecret}`).toString("base64");
  const response = await axios.post(
    BLING_TOKEN_URL,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: account.refreshToken }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "1.0",
      },
    }
  );
  const { access_token, refresh_token, expires_in } = response.data;
  const expiresAt = new Date(Date.now() + expires_in * 1000);
  await updateBlingToken(account.id, access_token, refresh_token, expiresAt);
  return access_token;
}

export async function getValidToken(account: BlingAccount): Promise<string> {
  const now = new Date();
  const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
  const bufferMs = 5 * 60 * 1000;
  if (!expiresAt || expiresAt.getTime() - now.getTime() < bufferMs) {
    return refreshBlingToken(account);
  }
  return account.accessToken;
}

function getHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function getOrdersByDate(account: BlingAccount, date: string) {
  const token = await getValidToken(account);
  let allOrders: any[] = [];
  let page = 1;
  const limite = 100;

  while (true) {
    const data = await blingRequest<any>({
      method: "GET",
      url: `${BLING_API}/pedidos/vendas`,
      headers: getHeaders(token),
      params: { dataInicial: date, dataFinal: date, pagina: page, limite },
      __accountId: account.id,
    } as any);
    const orders = data?.data ?? [];
    allOrders = allOrders.concat(orders);
    if (orders.length < limite) break;
    page++;
  }

  return allOrders;
}

export async function getOrderDetail(account: BlingAccount, orderId: number) {
  const token = await getValidToken(account);
  const data = await blingRequest<any>({
    method: "GET",
    url: `${BLING_API}/pedidos/vendas/${orderId}`,
    headers: getHeaders(token),
    __accountId: account.id,
  } as any);
  return data?.data;
}

// ─── Products ─────────────────────────────────────────────────────────────────

export async function getProductById(account: BlingAccount, productId: number) {
  const token = await getValidToken(account);
  const data = await blingRequest<any>({
    method: "GET",
    url: `${BLING_API}/produtos/${productId}`,
    headers: getHeaders(token),
    __accountId: account.id,
  } as any);
  return data?.data;
}

export async function getProductBySku(account: BlingAccount, sku: string): Promise<any | null> {
  const token = await getValidToken(account);
  const data = await blingRequest<any>({
    method: "GET",
    url: `${BLING_API}/produtos`,
    headers: getHeaders(token),
    params: { codigo: sku, limite: 5 },
    __accountId: account.id,
  } as any);
  const lista = data?.data ?? [];
  return lista.find((p: any) => (p.codigo ?? "").trim() === sku.trim()) ?? lista[0] ?? null;
}

export async function getProductByName(account: BlingAccount, name: string): Promise<any | null> {
  const token = await getValidToken(account);
  const data = await blingRequest<any>({
    method: "GET",
    url: `${BLING_API}/produtos`,
    headers: getHeaders(token),
    params: { nome: name, limite: 10 },
    __accountId: account.id,
  } as any);
  const lista = data?.data ?? [];
  // Retorna o primeiro produto com NCM válido, ou o primeiro da lista
  const withNcm = lista.find((p: any) => {
    const ncm = p?.tributacao?.ncm;
    return ncm && String(ncm).trim() !== '' && String(ncm).trim() !== '0000.00.00';
  });
  return withNcm ?? lista[0] ?? null;
}

export async function getProductByEan(account: BlingAccount, ean: string): Promise<any | null> {
  const token = await getValidToken(account);
  const data = await blingRequest<any>({
    method: "GET",
    url: `${BLING_API}/produtos`,
    headers: getHeaders(token),
    // A API Bling v3 suporta filtro por GTIN/EAN via parâmetro gtins[]
    params: { 'gtins[]': ean, limite: 5 },
    __accountId: account.id,
  } as any);
  const lista = data?.data ?? [];
  // Retorna o primeiro produto com NCM válido, ou o primeiro da lista
  const withNcm = lista.find((p: any) => {
    const ncm = p?.tributacao?.ncm;
    return ncm && String(ncm).trim() !== '' && String(ncm).trim() !== '0000.00.00';
  });
  return withNcm ?? lista[0] ?? null;
}

export async function createProduct(account: BlingAccount, productData: any) {
  const token = await getValidToken(account);
  const data = await blingRequest<any>({
    method: "POST",
    url: `${BLING_API}/produtos`,
    headers: getHeaders(token),
    data: productData,
  });
  return data?.data;
}

// ─── Clone Product ────────────────────────────────────────────────────────────

export async function cloneProductToAccount(
  sourceAccount: BlingAccount,
  destAccount: BlingAccount,
  productId: number
) {
  const sourceProduct = await getProductById(sourceAccount, productId);
  if (!sourceProduct) throw new Error(`Produto ${productId} não encontrado na conta origem`);

  const payload: any = {
    nome: sourceProduct.nome,
    codigo: sourceProduct.codigo,
    preco: sourceProduct.preco ?? 0,
    tipo: sourceProduct.tipo ?? "P",
    situacao: "A",
    formato: sourceProduct.formato ?? "S",
    descricaoCurta: sourceProduct.descricaoCurta ?? "",
    unidade: sourceProduct.unidade ?? "UN",
    pesoLiquido: sourceProduct.pesoLiquido ?? 0,
    pesoBruto: sourceProduct.pesoBruto ?? 0,
  };

  if (sourceProduct.tributacao) {
    payload.tributacao = {
      origem: sourceProduct.tributacao.origem ?? 0,
      ncm: sourceProduct.tributacao.ncm ?? "",
      cest: sourceProduct.tributacao.cest ?? "",
      codigoListaServicos: sourceProduct.tributacao.codigoListaServicos ?? "",
      spedTipoItem: sourceProduct.tributacao.spedTipoItem ?? "",
      codigoItem: sourceProduct.tributacao.codigoItem ?? "",
      percentualTributos: sourceProduct.tributacao.percentualTributos ?? 0,
      valorBaseStRetencao: sourceProduct.tributacao.valorBaseStRetencao ?? 0,
      valorStRetencao: sourceProduct.tributacao.valorStRetencao ?? 0,
      valorICMSSubstituto: sourceProduct.tributacao.valorICMSSubstituto ?? 0,
      codEnquadramentoIpi: sourceProduct.tributacao.codEnquadramentoIpi ?? "",
      valorIpiFixo: sourceProduct.tributacao.valorIpiFixo ?? 0,
      cotaIpi: sourceProduct.tributacao.cotaIpi ?? 0,
      classeIpi: sourceProduct.tributacao.classeIpi ?? "",
    };
  }

  return createProduct(destAccount, payload);
}

// ─── Ensure Products in Dest Account ──────────────────────────────────────

export interface EnsureProductResult {
  sku: string;
  action: "found" | "created";
  destProductId?: number;
}

export async function ensureProductsInDestAccount(
  sourceAccount: BlingAccount,
  destAccount: BlingAccount,
  items: Array<{ productId: number; sku: string; name: string; unit?: string; ncm?: string; origem?: number; cest?: string; price: number }>
): Promise<EnsureProductResult[]> {
  const destToken = await getValidToken(destAccount);

  // Paralelizar a busca de todos os produtos na conta destino
  const searchResults = await Promise.all(
    items.map(async (item) => {
      try {
        const searchResp = await blingRequest<any>({
          method: "GET",
          url: `${BLING_API}/produtos`,
          headers: getHeaders(destToken),
          params: { codigo: item.sku, limite: 5 },
        });
        const lista = searchResp?.data ?? [];
        const found = lista.find((p: any) => (p.codigo ?? "").trim() === item.sku.trim()) ?? lista[0] ?? null;
        return { item, found };
      } catch (e: any) {
        console.warn(`[ensureProducts] Erro ao buscar produto ${item.sku} na conta destino: ${e.message}`);
        return { item, found: null };
      }
    })
  );

  const results: EnsureProductResult[] = [];

  for (const { item, found: foundInDest } of searchResults) {
    if (foundInDest) {
      console.log(`[ensureProducts] Produto ${item.sku} já existe na conta destino (ID: ${foundInDest.id})`);
      results.push({ sku: item.sku, action: "found", destProductId: foundInDest.id });
      continue;
    }

    // Não encontrado: buscar detalhes na conta origem e criar na conta destino
    console.log(`[ensureProducts] Produto ${item.sku} não encontrado na conta destino. Criando...`);
    try {
      let sourceProduct: any = null;
      if (item.productId) {
        try {
          sourceProduct = await getProductById(sourceAccount, item.productId);
        } catch (e: any) {
          console.warn(`[ensureProducts] Não foi possível buscar produto ${item.productId} na origem: ${e.message}`);
        }
      }

      const payload: any = {
        nome: sourceProduct?.nome ?? item.name,
        codigo: item.sku,
        preco: sourceProduct?.preco ?? item.price ?? 0,
        tipo: sourceProduct?.tipo ?? "P",
        situacao: "A",
        formato: sourceProduct?.formato ?? "S",
        unidade: (sourceProduct?.unidade || item.unit || "UN").trim() || "UN",
        pesoLiquido: sourceProduct?.pesoLiquido ?? 0,
        pesoBruto: sourceProduct?.pesoBruto ?? 0,
      };

      // Tributacao: priorizar dados do sourceProduct, depois do item editado pelo usuário
      const ncm = sourceProduct?.tributacao?.ncm || item.ncm || "";
      const origem = sourceProduct?.tributacao?.origem ?? item.origem ?? 0;
      const cest = sourceProduct?.tributacao?.cest || item.cest || "";
      if (ncm || origem !== undefined) {
        payload.tributacao = {
          origem,
          ncm,
          cest,
          codigoListaServicos: sourceProduct?.tributacao?.codigoListaServicos ?? "",
          spedTipoItem: sourceProduct?.tributacao?.spedTipoItem ?? "",
          codigoItem: sourceProduct?.tributacao?.codigoItem ?? "",
          percentualTributos: sourceProduct?.tributacao?.percentualTributos ?? 0,
          valorBaseStRetencao: sourceProduct?.tributacao?.valorBaseStRetencao ?? 0,
          valorStRetencao: sourceProduct?.tributacao?.valorStRetencao ?? 0,
          valorICMSSubstituto: sourceProduct?.tributacao?.valorICMSSubstituto ?? 0,
          codEnquadramentoIpi: sourceProduct?.tributacao?.codEnquadramentoIpi ?? "",
          valorIpiFixo: sourceProduct?.tributacao?.valorIpiFixo ?? 0,
          cotaIpi: sourceProduct?.tributacao?.cotaIpi ?? 0,
          classeIpi: sourceProduct?.tributacao?.classeIpi ?? "",
        };
      }

      const created = await createProduct(destAccount, payload);
      console.log(`[ensureProducts] Produto ${item.sku} criado na conta destino (ID: ${created?.id})`);
      results.push({ sku: item.sku, action: "created", destProductId: created?.id });
    } catch (e: any) {
      console.error(`[ensureProducts] Falha ao criar produto ${item.sku} na conta destino: ${e.message}`);
      // Não lançar erro aqui: o item da NFe usa código/descrição, não ID do produto
      results.push({ sku: item.sku, action: "created" });
    }
  }

  return results;
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function getContactByCnpj(account: BlingAccount, cnpj: string) {
  const cnpjClean = cnpj.replace(/\D/g, "");
  const token = await getValidToken(account);

  // Estratégia 1: buscar por numeroDocumento (CNPJ sem pontuação)
  try {
    const data = await blingRequest<any>({
      method: "GET",
      url: `${BLING_API}/contatos`,
      headers: getHeaders(token),
      params: { numeroDocumento: cnpjClean, tipoPessoa: 2, limite: 10 },
    });
    const contatos = data?.data ?? [];
    // Verificar correspondência exata pelo CNPJ
    const match = contatos.find((c: any) => {
      const cpfCnpj = (c.cpfCnpj ?? "").replace(/\D/g, "");
      return cpfCnpj === cnpjClean;
    });
    // Mesmo sem cpfCnpj preenchido na lista, se retornou apenas 1 resultado é o correto
    if (match) {
      console.log(`[getContactByCnpj] Contato encontrado via numeroDocumento: ${match.nome} (ID: ${match.id})`);
      return match;
    }
    if (contatos.length === 1) {
      console.log(`[getContactByCnpj] Contato encontrado (1 resultado) via numeroDocumento: ${contatos[0].nome} (ID: ${contatos[0].id})`);
      return contatos[0];
    }
    if (contatos.length > 1) {
      // Múltiplos resultados: pegar o que tem CNPJ preenchido ou o primeiro
      const withCnpj = contatos.find((c: any) => (c.cpfCnpj ?? "").replace(/\D/g, "") === cnpjClean);
      if (withCnpj) {
        console.log(`[getContactByCnpj] Contato com CNPJ exato encontrado: ${withCnpj.nome} (ID: ${withCnpj.id})`);
        return withCnpj;
      }
      console.log(`[getContactByCnpj] ${contatos.length} contatos encontrados, usando o primeiro: ${contatos[0].nome} (ID: ${contatos[0].id})`);
      return contatos[0];
    }
  } catch (err: any) {
    console.warn(`[getContactByCnpj] Estratégia 1 falhou: ${err.message}`);
  }

  // Estratégia 2: buscar por nome da empresa (sem tipoPessoa)
  try {
    const data2 = await blingRequest<any>({
      method: "GET",
      url: `${BLING_API}/contatos`,
      headers: getHeaders(token),
      params: { numeroDocumento: cnpjClean, limite: 10 },
    });
    const contatos2 = data2?.data ?? [];
    const match2 = contatos2.find((c: any) => {
      const cpfCnpj = (c.cpfCnpj ?? "").replace(/\D/g, "");
      return cpfCnpj === cnpjClean;
    });
    if (match2) {
      console.log(`[getContactByCnpj] Contato encontrado via estratégia 2: ${match2.nome} (ID: ${match2.id})`);
      return match2;
    }
    if (contatos2.length > 0) {
      console.log(`[getContactByCnpj] Contato encontrado via estratégia 2 (sem tipoPessoa): ${contatos2[0].nome} (ID: ${contatos2[0].id})`);
      return contatos2[0];
    }
  } catch (err: any) {
    console.warn(`[getContactByCnpj] Estratégia 2 falhou: ${err.message}`);
  }

  console.log(`[getContactByCnpj] Nenhum contato encontrado para CNPJ ${cnpjClean}`);
  return null;
}

export async function enrichContactWithCnpjData(
  account: BlingAccount,
  contactId: number,
  cnpj: string
): Promise<void> {
  const cnpjClean = cnpj.replace(/\D/g, "");
  if (cnpjClean.length !== 14) return;

  try {
    const resp = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpjClean}`);
    const d = resp.data;
    if (!d?.municipio) return;

    const token = await getValidToken(account);
    // Buscar o contato completo para preservar TODOS os campos existentes (incluindo inscrição estadual)
    let existingContact: any = {};
    try {
      const contactDetail = await blingRequest<any>({
        method: "GET",
        url: `${BLING_API}/contatos/${contactId}`,
        headers: getHeaders(token),
      });
      existingContact = contactDetail?.data ?? {};
    } catch (_) {}

    // Montar o payload preservando todos os campos existentes e apenas atualizando o endereço
    const updatePayload: any = {
      // Preservar todos os campos existentes do contato
      ...existingContact,
      // Garantir campos obrigatórios
      id: contactId,
      nome: existingContact.nome || `Contato ${cnpjClean}`,
      situacao: existingContact.situacao || "A",
      tipo: existingContact.tipo || "J",
      numeroDocumento: cnpjClean,
      // Atualizar apenas o endereço com dados da BrasilAPI
      endereco: {
        ...(existingContact.endereco ?? {}),
        geral: {
          ...(existingContact.endereco?.geral ?? {}),
          endereco: d.logradouro ?? existingContact.endereco?.geral?.endereco ?? "",
          numero: d.numero ?? existingContact.endereco?.geral?.numero ?? "",
          complemento: d.complemento ?? existingContact.endereco?.geral?.complemento ?? "",
          bairro: d.bairro ?? existingContact.endereco?.geral?.bairro ?? "",
          municipio: d.municipio ?? existingContact.endereco?.geral?.municipio ?? "",
          uf: d.uf ?? existingContact.endereco?.geral?.uf ?? "",
          cep: (d.cep ?? "").replace(/\D/g, "") || existingContact.endereco?.geral?.cep || "",
        },
      },
    };

    console.log(`[enrichContact] Atualizando contato ${contactId} com payload:`, JSON.stringify(updatePayload));
    await blingRequest<any>({
      method: "PUT",
      url: `${BLING_API}/contatos/${contactId}`,
      headers: getHeaders(token),
      data: updatePayload,
    });
    console.log(`[enrichContact] Contato ${contactId} atualizado com dados do CNPJ ${cnpjClean}: ${d.municipio}/${d.uf}`);
  } catch (err: any) {
    const errData = (err as any)?.response?.data;
    console.warn(`[enrichContact] Falha ao enriquecer contato ${contactId} com CNPJ ${cnpjClean}: ${err.message}`, errData ? JSON.stringify(errData) : '');
  }
}

// ─── Create Contact from CNPJ ───────────────────────────────────────────────

export async function createContactFromCnpj(
  account: BlingAccount,
  cnpj: string
): Promise<{ id: number; nome: string }> {
  const cnpjClean = cnpj.replace(/\D/g, "");
  const token = await getValidToken(account);

  // Buscar dados da empresa via BrasilAPI
  let nome = cnpj;
  let fantasia = "";
  let logradouro = "";
  let numero = "";
  let complemento = "";
  let bairro = "";
  let municipio = "";
  let uf = "";
  let cep = "";

  try {
    const resp = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpjClean}`);
    const d = resp.data;
    nome = d.razao_social ?? d.nome_fantasia ?? cnpj;
    fantasia = d.nome_fantasia ?? "";
    logradouro = d.logradouro ?? "";
    numero = d.numero ?? "";
    complemento = d.complemento ?? "";
    bairro = d.bairro ?? "";
    municipio = d.municipio ?? "";
    uf = d.uf ?? "";
    cep = (d.cep ?? "").replace(/\D/g, "");
    console.log(`[createContactFromCnpj] Dados BrasilAPI para ${cnpjClean}: ${nome} - ${municipio}/${uf}`);
  } catch (err: any) {
    console.warn(`[createContactFromCnpj] BrasilAPI falhou para ${cnpjClean}: ${err.message}. Criando contato apenas com CNPJ.`);
  }

  const payload: any = {
    nome,
    cpfCnpj: cnpjClean,
    tipo: "J",
    situacao: "A",
  };

  if (fantasia) payload.fantasia = fantasia;

  if (municipio) {
    payload.endereco = {
      geral: {
        endereco: logradouro,
        numero,
        complemento,
        bairro,
        municipio,
        uf,
        cep,
      },
    };
  }

  const data = await blingRequest<any>({
    method: "POST",
    url: `${BLING_API}/contatos`,
    headers: getHeaders(token),
    data: payload,
  });

  const created = data?.data;
  if (!created?.id) {
    throw new Error(`Falha ao criar contato com CNPJ ${cnpj} na conta destino.`);
  }

  console.log(`[createContactFromCnpj] Contato criado: ${nome} (ID: ${created.id})`);
  return { id: created.id, nome };
}

// ─── Natureza de Operação ─────────────────────────────────────────────────────

export async function getNaturezaOperacaoId(
  account: BlingAccount,
  nome: string
): Promise<number | null> {
  try {
    const token = await getValidToken(account);
    const data = await blingRequest<any>({
      method: "GET",
      url: `${BLING_API}/naturezasoperacoes`,
      headers: getHeaders(token),
    });
    const lista = data?.data ?? [];
    const found = lista.find((n: any) =>
      (n.descricao ?? "").toLowerCase().includes(nome.toLowerCase())
    );
    return found?.id ?? null;
  } catch (err: any) {
    console.warn(`[getNaturezaOperacaoId] Erro: ${err.message}`);
    return null;
  }
}

// ─── NFe / Nota de Venda ──────────────────────────────────────────────────────

export interface NFeItem {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  price: number;
  unit?: string;
  ncm?: string;
  origem?: number;
  cest?: string;
}

export async function createSaleNFe(
  account: BlingAccount,
  contactId: number,
  contactName: string,
  items: NFeItem[],
  originCnpj?: string
) {
  const cnpjClean = originCnpj ? originCnpj.replace(/\D/g, "") : "";

  // Executar em paralelo: token, enriquecimento do contato, endereço BrasilAPI e natureza de operação
  const [token, , enderecoNFe, naturezaId] = await Promise.all([
    getValidToken(account),
    // Enriquecer cadastro do contato com dados do CNPJ (em paralelo, não bloqueia)
    originCnpj
      ? enrichContactWithCnpjData(account, contactId, originCnpj).catch((err: any) =>
          console.warn(`[createSaleNFe] enrichContact falhou (não crítico): ${err.message}`)
        )
      : Promise.resolve(),
    // Buscar endereço via BrasilAPI
    (async () => {
      if (!cnpjClean || cnpjClean.length !== 14) return undefined;
      try {
        const resp = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpjClean}`);
        const d = resp.data;
        console.log(`[createSaleNFe] Endereço BrasilAPI para NFe: ${d.municipio}/${d.uf}`);
        return {
          endereco: d.logradouro ?? "",
          numero: d.numero ?? "",
          complemento: d.complemento ?? "",
          bairro: d.bairro ?? "",
          municipio: d.municipio ?? "",
          uf: d.uf ?? "",
          cep: (d.cep ?? "").replace(/\D/g, ""),
        };
      } catch (err: any) {
        console.warn(`[createSaleNFe] BrasilAPI falhou para endereço: ${err.message}`);
        return undefined;
      }
    })(),
    // Buscar natureza de operação em paralelo
    getNaturezaOperacaoId(account, "Venda de mercadoria com ST"),
  ]);

  const itensSemNcm = items.filter((item) => !item.ncm || item.ncm.trim() === "");
  if (itensSemNcm.length > 0) {
    const nomes = itensSemNcm.map((i) => i.name).join(", ");
    throw new Error(
      `Os seguintes produtos não têm NCM cadastrado: ${nomes}. Cadastre o NCM no Bling antes de emitir a nota.`
    );
  }

  const nfeItems = items.map((item) => {
    const itemPayload: any = {
      codigo: item.sku,
      descricao: item.name,
      unidade: (item.unit || "UN").trim() || "UN",
      quantidade: item.quantity,
      valor: item.price,
      tipo: "P",
    };

    if (item.ncm) itemPayload.classificacaoFiscal = item.ncm;
    if (item.origem !== undefined) itemPayload.origem = item.origem;
    if (item.cest) itemPayload.cest = item.cest;

    return itemPayload;
  });

  // Data de operação no formato exigido pela API Bling v3: "YYYY-MM-DD HH:MM:SS"
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dataOperacao = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // Montar payload do contato com todos os campos obrigatórios da NFe
  const contatoPayload: any = {
    id: contactId,
    nome: contactName,
    tipoPessoa: "J",          // Jurídica
    contribuinte: 1,           // Contribuinte do ICMS
  };
  if (cnpjClean) {
    contatoPayload.numeroDocumento = cnpjClean;
  }
  if (enderecoNFe) {
    contatoPayload.endereco = enderecoNFe;
  }

  const payload: any = {
    tipo: 1,
    dataOperacao,
    contato: contatoPayload,
    itens: nfeItems,
  };

  if (naturezaId) {
    payload.naturezaOperacao = { id: naturezaId };
  }

  console.log(`[createSaleNFe] Payload contato: ${JSON.stringify(contatoPayload)} | dataOperacao: ${dataOperacao}`);
  console.log(`[createSaleNFe] naturezaId: ${naturezaId}`);
  console.log(`[createSaleNFe] Itens: ${nfeItems.length}`);
  console.log(`[createSaleNFe] Payload completo:`, JSON.stringify(payload, null, 2));

  const data = await blingRequest<any>({
    method: "POST",
    url: `${BLING_API}/nfe`,
    headers: getHeaders(token),
    data: payload,
  });

  return data?.data;
}

// ─── Extract Products from Orders ─────────────────────────────────────────────

export interface ExtractedProduct {
  orderId: number;
  orderNumber: string;
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  price: number;
  unit: string;
  ncm?: string;
  origem?: number;
  cest?: string;
}

export async function extractProductsFromOrders(
  account: BlingAccount,
  orders: any[]
): Promise<ExtractedProduct[]> {
  const productMap = new Map<string, ExtractedProduct>();
  const t0 = Date.now();
  console.log(`[extractProducts] Iniciando extração de ${orders.length} pedidos...`);

  // Passo 1: Buscar detalhes de todos os pedidos em lotes pequenos com delay entre lotes
  const orderDetails: Array<{ order: any; detail: any }> = [];
  for (let i = 0; i < orders.length; i += PARALLEL_BATCH_SIZE) {
    const batch = orders.slice(i, i + PARALLEL_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (order) => {
        try {
          const detail = await getOrderDetail(account, order.id);
          return { order, detail };
        } catch (err: any) {
          console.warn(`[extractProducts] Erro ao buscar pedido ${order.id}: ${err.message}`);
          return { order, detail: null };
        }
      })
    );
    orderDetails.push(...batchResults);
    // Delay entre lotes para evitar 429
    if (i + PARALLEL_BATCH_SIZE < orders.length) {
      await sleep(BATCH_DELAY_MS);
    }
    console.log(`[extractProducts] Lote ${Math.floor(i / PARALLEL_BATCH_SIZE) + 1}/${Math.ceil(orders.length / PARALLEL_BATCH_SIZE)} concluído`);
  }
  console.log(`[extractProducts] Detalhes de pedidos obtidos em ${Date.now() - t0}ms`);

  // Passo 2: Extrair itens únicos dos pedidos (por SKU)
  const skuFirstSeen = new Map<string, { order: any; item: any }>();
  for (const { order, detail } of orderDetails) {
    if (!detail) continue;
    const itens = detail?.itens ?? [];
    for (const item of itens) {
      const productId = item.produto?.id ?? item.id;
      const sku = item.codigo ?? item.produto?.codigo ?? String(productId);
      const name = item.descricao ?? item.produto?.descricao ?? item.produto?.nome ?? "Produto sem nome";
          const unit = (item.unidade || item.produto?.unidade || "UN").trim() || "UN";

      if (productMap.has(sku)) {
        // Produto já visto: apenas somar quantidade
        productMap.get(sku)!.quantity += item.quantidade ?? 1;
      } else {
        // Novo produto: registrar para buscar NCM depois
        productMap.set(sku, {
          orderId: order.id,
          orderNumber: order.numero ?? String(order.id),
          productId,
          sku,
          name,
          quantity: item.quantidade ?? 1,
          price: item.valor ?? 0,
          unit,
          ncm: undefined,
          origem: undefined,
          cest: undefined,
        });
        skuFirstSeen.set(sku, { order, item });
      }
    }
  }

  const uniqueProducts = Array.from(productMap.values());
  console.log(`[extractProducts] ${uniqueProducts.length} produtos únicos encontrados. Buscando NCMs sequencialmente...`);

  // Passo 3: Buscar NCM sequencialmente para não sobrecarregar a API do Bling
  for (const prod of uniqueProducts) {
    if (!prod.productId) continue;

      // Verificar cache primeiro — busca por SKU (índice UNIQUE atual)
      try {
        const cached = await getNcmFromCacheBySku(account.id, prod.sku);
        if (cached) {
          prod.ncm = cached.ncm ?? undefined;
          prod.origem = cached.origem ?? undefined;
          prod.cest = cached.cest ?? undefined;
          if (prod.ncm) {
            console.log(`[extractProducts] NCM do produto ${prod.sku} (cache): ${prod.ncm}`);
            continue; // Já temos o NCM do cache, não precisa chamar a API
          }
        }
      } catch (cacheErr: any) {
        console.warn(`[extractProducts] Erro ao ler cache NCM para ${prod.sku}: ${cacheErr.message}`);
      }

      // Buscar da API do Bling
      try {
        const prodDetail = await getProductById(account, prod.productId);
        const rawNcm = prodDetail?.tributacao?.ncm;
        // Considerar NCM válido apenas se não for vazio nem "0000.00.00"
        const isValidNcm = (v: any) => v && String(v).trim() !== "" && String(v).trim() !== "0000.00.00";
        prod.ncm = isValidNcm(rawNcm) ? String(rawNcm).trim() : undefined;
        prod.origem = prodDetail?.tributacao?.origem ?? undefined;
        prod.cest = prodDetail?.tributacao?.cest || undefined;

        if (prod.ncm) {
          console.log(`[extractProducts] NCM do produto ${prod.sku}: ${prod.ncm}`);
        } else {
          // Fallback: buscar NCM da última NFe emitida para este produto
          console.log(`[extractProducts] Produto ${prod.sku} sem NCM válido no cadastro. Tentando fallback NFe...`);
          try {
            const token = await getValidToken(account);
            const nfeResp = await blingRequest<any>({
              method: "GET",
              url: `${BLING_API}/nfe`,
              headers: getHeaders(token),
              params: { idProduto: prod.productId, limite: 1 },
            });
            const nfeList = nfeResp?.data ?? [];
            if (nfeList.length > 0) {
              const nfeDetail = await blingRequest<any>({
                method: "GET",
                url: `${BLING_API}/nfe/${nfeList[0].id}`,
                headers: getHeaders(token),
              });
              const nfeItens = nfeDetail?.data?.itens ?? [];
              const nfeItem = nfeItens.find((i: any) => i.codigo === prod.sku) ?? nfeItens[0];
              if (isValidNcm(nfeItem?.classificacaoFiscal)) {
                prod.ncm = String(nfeItem.classificacaoFiscal).trim();
                if (!prod.origem && nfeItem.origem !== undefined) prod.origem = nfeItem.origem;
                if (!prod.cest && nfeItem.cest) prod.cest = nfeItem.cest;
                console.log(`[extractProducts] NCM do produto ${prod.sku} via NFe fallback: ${prod.ncm}`);
              }
            }
          } catch (e2: any) {
            console.warn(`[extractProducts] Fallback NFe falhou para ${prod.productId}: ${e2.message}`);
          }
        }

        // Salvar no cache SOMENTE se tiver NCM válido
        if (prod.ncm) {
          try {
            await upsertNcmCache({
              accountId: account.id,
              productId: prod.productId,
              sku: prod.sku,
              ncm: prod.ncm,
              origem: prod.origem ?? null,
              cest: prod.cest ?? null,
            });
          } catch (cacheWriteErr: any) {
            console.warn(`[extractProducts] Erro ao salvar cache NCM para ${prod.sku}: ${cacheWriteErr.message}`);
          }
        }
      } catch (e: any) {
        console.warn(`[extractProducts] Erro ao buscar NCM do produto ${prod.productId}: ${e.message}`);
      }
  }

  console.log(`[extractProducts] Extração concluída em ${Date.now() - t0}ms. Total: ${uniqueProducts.length} produtos.`);
  return uniqueProducts;
}
