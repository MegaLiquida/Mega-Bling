import axios from "axios";

const MAGIS5_API = "https://app.magis5.com.br/v1";

// Cache de NCM por EAN para evitar baixar o mesmo XML várias vezes
const ncmByEanCache = new Map<string, string>();
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function magis5Request<T>(
  apiKey: string,
  url: string,
  params?: Record<string, any>,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    const response = await axios.get(url, {
      headers: {
        "X-MAGIS5-APIKEY": apiKey,
        "Content-Type": "application/json",
      },
      params,
    });
    return response.data;
  } catch (err: any) {
    const status = err?.response?.status;
    if (retries > 0 && (status === 429 || status === 503 || status === 502)) {
      const waitMs = Math.pow(2, MAX_RETRIES - retries + 1) * 1000;
      console.warn(`[Magis5Service] Status ${status}. Aguardando ${waitMs}ms...`);
      await sleep(waitMs);
      return magis5Request<T>(apiKey, url, params, retries - 1);
    }
    const message = err?.response?.data?.message ?? err.message;
    console.error(`[Magis5Service] Erro ${status} na URL ${url}:`, err?.response?.data);
    throw new Error(`Magis5 API error ${status ?? "?"}: ${message}`);
  }
}

// ─── Orders ───────────────────────────────────────────────────────────────────

/**
 * Busca pedidos faturados no Magis5 para uma data específica.
 * Usa o campo dateLastUpdated para filtrar por data de faturamento.
 */
export async function getMagis5OrdersByDate(apiKey: string, date: string): Promise<any[]> {
  // Converter data "YYYY-MM-DD" para timestamps Unix (início e fim do dia em BRT = UTC-3)
  const dateObj = new Date(`${date}T00:00:00-03:00`);
  const timestampFrom = Math.floor(dateObj.getTime() / 1000);
  const dateEnd = new Date(`${date}T23:59:59-03:00`);
  const timestampTo = Math.floor(dateEnd.getTime() / 1000);

  let allOrders: any[] = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const data = await magis5Request<any>(
      apiKey,
      `${MAGIS5_API}/orders`,
      {
        status: "billed",
        structureType: "Complete",
        limit,
        page,
        timestampFrom,
        timestampTo,
      }
    );

    const orders: any[] = data?.orders ?? [];
    allOrders = allOrders.concat(orders);

    console.log(`[Magis5Service] Página ${page}: ${orders.length} pedidos faturados`);

    if (orders.length < limit) break;
    page++;
    await sleep(300);
  }

  console.log(`[Magis5Service] Total de pedidos faturados em ${date}: ${allOrders.length}`);
  return allOrders;
}

// ─── Extract Products ─────────────────────────────────────────────────────────

export interface Magis5ExtractedProduct {
  orderId: string;
  orderNumber: string;
  sku: string;
  name: string;
  quantity: number;
  price: number;
  unit: string;
  ean?: string;
  // NCM não vem direto do Magis5 — será buscado no Bling pela SKU/EAN
  ncm?: string;
  origem?: number;
  cest?: string;
}

/**
 * Resultado da extração do XML da NFe: mapa de identificadores -> NCM
 * e lista ordenada de NCMs por posição do item na nota.
 */
interface NfeXmlResult {
  byEan: Map<string, string>;   // EAN/GTIN -> NCM
  byCProd: Map<string, string>; // cProd (código do produto no XML) -> NCM
  byIndex: string[];            // NCM por índice (posição do item na nota, 0-based)
}

/**
 * Baixa o XML da NFe e extrai NCMs por EAN, cEANTrib, cProd e posição.
 */
async function extractNcmFromNfeXml(xmlUrl: string): Promise<NfeXmlResult> {
  const result: NfeXmlResult = { byEan: new Map(), byCProd: new Map(), byIndex: [] };
  try {
    const response = await axios.get(xmlUrl, { timeout: 15000, responseType: "text" });
    const xml: string = response.data;

    // Extrair todos os blocos <det> (itens da nota)
    const detBlocks = xml.match(/<det[^>]*>[\s\S]*?<\/det>/g) ?? [];
    for (const block of detBlocks) {
      const eanMatch    = block.match(/<cEAN>(.*?)<\/cEAN>/);
      const eanTribMatch = block.match(/<cEANTrib>(.*?)<\/cEANTrib>/);
      const cProdMatch  = block.match(/<cProd>(.*?)<\/cProd>/);
      const ncmMatch    = block.match(/<NCM>(.*?)<\/NCM>/);

      const ean    = eanMatch?.[1]?.trim() ?? "";
      const eanTrib = eanTribMatch?.[1]?.trim() ?? "";
      const cProd  = cProdMatch?.[1]?.trim() ?? "";
      const ncmRaw = ncmMatch?.[1]?.trim() ?? "";

      if (!ncmRaw || ncmRaw === "00000000") {
        result.byIndex.push("");
        continue;
      }

      // Formatar NCM como XXXX.XX.XX
      const formatted = ncmRaw.length === 8
        ? `${ncmRaw.slice(0, 4)}.${ncmRaw.slice(4, 6)}.${ncmRaw.slice(6, 8)}`
        : ncmRaw;

      result.byIndex.push(formatted);

      // Mapear por EAN (cEAN)
      if (ean && ean !== "SEM GTIN" && ean !== "0") {
        result.byEan.set(ean, formatted);
      }
      // Mapear por EAN tributário (cEANTrib) — frequentemente é o EAN real
      if (eanTrib && eanTrib !== "SEM GTIN" && eanTrib !== "0" && eanTrib !== ean) {
        result.byEan.set(eanTrib, formatted);
      }
      // Mapear por cProd (código interno do produto no XML)
      if (cProd) {
        result.byCProd.set(cProd, formatted);
      }
    }

    console.log(`[Magis5Service] XML extraído: ${result.byEan.size} EANs, ${result.byCProd.size} cProds, ${result.byIndex.length} itens`);
  } catch (err: any) {
    console.warn(`[Magis5Service] Não foi possível baixar XML da NFe (${xmlUrl}): ${err.message}`);
  }
  return result;
}

/**
 * Extrai produtos únicos dos pedidos do Magis5, consolidando quantidades.
 * Os pedidos do Magis5 já vêm com structureType=Complete, então não precisamos
 * de chamadas extras para detalhes — tudo está no objeto do pedido.
 * Também extrai o NCM do XML da NFe de cada pedido.
 */
export async function extractProductsFromMagis5Orders(orders: any[]): Promise<Magis5ExtractedProduct[]> {
  const productMap = new Map<string, Magis5ExtractedProduct>();

  // Cache por EAN e por cProd (código do produto no XML)
  const ncmByEan = new Map<string, string>(ncmByEanCache);
  const ncmByCProd = new Map<string, string>();

  // Passo 1: extrair NCMs dos XMLs das NFes e associar ao pedido
  // Manter mapa de orderId -> NfeXmlResult para lookup por índice
  const orderNfeResults = new Map<string, NfeXmlResult>();

  const xmlPromises = orders.map(async (order) => {
    const invoices: any[] = order.invoices ?? [];
    if (invoices.length === 0) return;
    const xmlUrl: string = invoices[0]?.urlXml ?? "";
    if (!xmlUrl) return;
    const nfeResult = await extractNcmFromNfeXml(xmlUrl);
    const orderId = String(order.id ?? order.externalId ?? "");
    orderNfeResults.set(orderId, nfeResult);

    // Popular caches globais
    nfeResult.byEan.forEach((ncm, ean) => {
      if (!ncmByEan.has(ean)) ncmByEan.set(ean, ncm);
      if (!ncmByEanCache.has(ean)) ncmByEanCache.set(ean, ncm);
    });
    nfeResult.byCProd.forEach((ncm, cProd) => {
      if (!ncmByCProd.has(cProd)) ncmByCProd.set(cProd, ncm);
    });
  });

  // Processar em lotes de 5 para não sobrecarregar
  for (let i = 0; i < xmlPromises.length; i += 5) {
    await Promise.all(xmlPromises.slice(i, i + 5));
    if (i + 5 < xmlPromises.length) await sleep(200);
  }

  // Passo 2: extrair produtos e aplicar NCM
  for (const order of orders) {
    const orderId = String(order.id ?? order.externalId ?? "");
    const orderNumber = String(order.packId ?? order.id ?? "");
    const items: any[] = order.order_items ?? [];
    const nfeResult = orderNfeResults.get(orderId);

    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
      const item = items[itemIdx];
      const itemData = item.item ?? {};
      const ean = String(itemData.ean ?? itemData.seller_custom_field ?? "").trim();
      const sku = String(itemData.seller_custom_field || ean || (itemData.id ?? "")).trim();
      const name = itemData.title ?? "Produto sem nome";
      const quantity = Number(item.quantity ?? 1);
      const price = Number(item.unit_price ?? 0);
      const unit = (item.unitMeasurement || "UN").trim() || "UN";

      if (!sku) continue;

      // Buscar NCM em ordem de prioridade:
      // 1. Por EAN do item no cache global
      // 2. Por SKU no cache global
      // 3. Por índice do item na NFe (posição)
      // 4. Por cProd (código do produto no XML)
      let ncm: string | undefined =
        ncmByEan.get(ean) ??
        ncmByEan.get(sku) ??
        (nfeResult?.byIndex[itemIdx] || undefined) ??
        ncmByCProd.get(sku) ??
        undefined;

      if (!ncm) {
        console.warn(`[Magis5Service] NCM não encontrado para SKU=${sku} EAN=${ean} idx=${itemIdx}`);
      }

      if (productMap.has(sku)) {
        productMap.get(sku)!.quantity += quantity;
        // Atualizar NCM se ainda não tinha
        if (!productMap.get(sku)!.ncm && ncm) {
          productMap.get(sku)!.ncm = ncm;
        }
      } else {
        productMap.set(sku, {
          orderId,
          orderNumber,
          sku,
          name,
          quantity,
          price,
          unit,
          ean: ean || undefined,
          ncm,
          origem: 0,
          cest: "",
        });
      }
    }
  }

  const products = Array.from(productMap.values());
  const withNcm = products.filter(p => p.ncm).length;
  console.log(`[Magis5Service] ${products.length} produtos únicos extraídos de ${orders.length} pedidos. ${withNcm}/${products.length} com NCM encontrado.`);
  return products;
}
