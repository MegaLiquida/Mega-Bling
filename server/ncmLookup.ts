import { getDb } from "./db";
import { ncmCache, inArray } from "../drizzle/schema";
import { getBlingAccountsByUserId } from "./db";
import { getProductBySku, getProductByName, getProductByEan } from "./blingService";
import { upsertNcmCacheBySku } from "./db";

const OWNER_USER_ID = 1;

// Dicionário de sinônimos: nome popular → termo técnico
const SYNONYMS: Record<string, string> = {
  'geladeira': 'refrigerador',
  'gelada': 'refrigerador',
  'frigorifico': 'refrigerador',
  'fogao': 'fogao',
  'cooktop': 'fogao',
  'coifa': 'exaustor',
  'depurador': 'exaustor',
  'televisao': 'televisor',
  'televisor': 'televisor',
  'tv': 'televisor',
  'tela': 'televisor',
  'monitor': 'monitor',
  'notebook': 'computador',
  'laptop': 'computador',
  'computador': 'computador',
  'desktop': 'computador',
  'tablet': 'tablet',
  'celular': 'telefone',
  'smartphone': 'telefone',
  'microondas': 'microondas',
  'micro-ondas': 'microondas',
  'lavadora': 'lavadora',
  'maquina': 'lavadora',
  'secadora': 'secadora',
  'lava-loucas': 'lava-loucas',
  'lavalouca': 'lava-loucas',
  'liquidificador': 'liquidificador',
  'batedeira': 'batedeira',
  'processador': 'processador',
  'fritadeira': 'fritadeira',
  'airfryer': 'fritadeira',
  'fryer': 'fritadeira',
  'cafeteira': 'cafeteira',
  'espresso': 'cafeteira',
  'aspirador': 'aspirador',
  'ventilador': 'ventilador',
  'climatizador': 'climatizador',
  'ar-condicionado': 'condicionador',
  'condicionador': 'condicionador',
  'aquecedor': 'aquecedor',
  'chuveiro': 'chuveiro',
  'purificador': 'purificador',
  'freezer': 'congelador',
  'congelador': 'congelador',
  'adega': 'adega',
  'cervejeira': 'adega',
  'impressora': 'impressora',
  'scanner': 'scanner',
  'roteador': 'roteador',
  'switch': 'comutador',
  'projetor': 'projetor',
  'camera': 'camera',
  'filmadora': 'camera',
  'forno': 'forno',
  'torradeira': 'torradeira',
  'sanduicheira': 'grelha',
  'grill': 'grelha',
  'panela': 'panela',
  'chaleira': 'chaleira',
  'ferro': 'ferro',
  'secador': 'secador',
  'chapinha': 'alisador',
  'alisador': 'alisador',
  'escova': 'escova',
  'barbeador': 'barbeador',
  'depilador': 'depilador',
  'massageador': 'massageador',
  'balanca': 'balanca',
  'medidor': 'medidor',
  'termometro': 'termometro',
  'caixa': 'caixa',
  'som': 'amplificador',
  'soundbar': 'amplificador',
  'fone': 'fone',
  'headphone': 'fone',
  'headset': 'fone',
  'caixa-de-som': 'amplificador',
  'speaker': 'amplificador',
  'controle': 'controle',
  'joystick': 'controle',
  'videogame': 'videogame',
  'console': 'videogame',
};

// Mapeamento direto: palavra-chave → NCM
const DIRECT_NCM: Record<string, string> = {
  // Calçados
  'bota': '6403.99.90',
  'botina': '6403.40.00',
  'sapato': '6403.99.90',
  'tenis': '6404.11.00',
  'sandalia': '6402.20.00',
  'chinelo': '6402.20.00',
  'tamanco': '6401.92.00',
  'mocassim': '6403.99.90',
  'scarpin': '6403.99.90',
  'sapatilha': '6404.19.00',
  'chuteira': '6404.11.00',
  'pantufla': '6404.20.00',
  'alpargata': '6404.19.00',
  // Roupas
  'camiseta': '6109.10.00',
  'camisa': '6205.20.00',
  'blusa': '6110.20.10',
  'vestido': '6104.42.00',
  'calca': '6103.42.00',
  'short': '6103.42.00',
  'bermuda': '6103.42.00',
  'saia': '6104.52.00',
  'jaqueta': '6201.93.00',
  'casaco': '6201.93.00',
  'moletom': '6110.20.10',
  'sueter': '6110.20.10',
  'meia': '6115.95.00',
  'cueca': '6107.11.00',
  'calcinha': '6108.21.00',
  'sutiã': '6212.10.00',
  'sutia': '6212.10.00',
  'pijama': '6107.21.00',
  'regata': '6109.10.00',
  'polo': '6105.10.00',
  'gravata': '6215.10.00',
  'cinto': '4205.00.90',
  'bolsa': '4202.22.00',
  'mochila': '4202.92.00',
  'carteira': '4202.31.00',
  'chapeu': '6504.00.00',
  'bone': '6505.00.90',
  'oculos': '9004.10.00',
  'relogio': '9102.12.00',
  'pulseira': '7117.19.90',
  'colar': '7117.19.90',
  'brinco': '7117.19.90',
  'anel': '7117.19.90',
  // Móveis e decoração
  'sofa': '9401.61.00',
  'cadeira': '9401.61.00',
  'mesa': '9403.30.00',
  'cama': '9403.50.00',
  'guarda-roupa': '9403.50.00',
  'armario': '9403.50.00',
  'estante': '9403.30.00',
  'escrivaninha': '9403.30.00',
  'colchao': '9404.21.00',
  'tapete': '5703.20.00',
  'cortina': '6303.92.00',
  'luminaria': '9405.40.90',
  'abajur': '9405.40.90',
  // Brinquedos
  'brinquedo': '9503.00.90',
  'boneca': '9502.10.00',
  'carrinho': '9503.00.10',
  'lego': '9503.00.90',
  'quebra-cabeca': '9503.00.90',
  // Esporte
  'bicicleta': '8712.00.90',
  'patins': '9506.70.00',
  'skate': '9506.70.00',
  'bola': '9506.62.00',
  'raquete': '9506.51.00',
  'haltere': '9506.91.00',
  'esteira': '9506.91.00',
  'colchonete': '9506.91.00',
  // Ferramentas
  'furadeira': '8467.21.00',
  'parafusadeira': '8467.21.00',
  'serra': '8467.29.90',
  'marreta': '8205.20.00',
  'chave': '8204.11.00',
  'alicate': '8203.20.00',
  'fita': '3919.10.00',
  // Papelaria
  'caneta': '9608.10.00',
  'lapis': '9609.10.00',
  'caderno': '4820.10.10',
  'agenda': '4820.10.10',
  'pasta': '4820.30.00',
};

function isValidNcm(v: any): boolean {
  return v && String(v).trim() !== '' && String(v).trim() !== '0000.00.00';
}

function lookupDirectNcm(productName: string): string | null {
  const normalized = productName
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(w => w.length > 2);
  for (const word of words) {
    if (DIRECT_NCM[word]) return DIRECT_NCM[word];
  }
  return null;
}

function extractKeywords(productName: string): string {
  const stopwords = new Set([
    'de','da','do','das','dos','e','em','para','com','por','um','uma','os','as','a','o',
    'no','na','nos','nas','ao','aos','pelo','pela','pelos','pelas','se','que','ou',
    // Cores
    'preto','preta','branco','branca','prata','cinza','azul','vermelho','vermelha',
    'verde','rosa','amarelo','amarela','laranja','roxo','roxa','marrom','bege','inox',
    // Voltagens e medidas
    '127v','220v','110v','bivolt','litros','litro','watts','watt','volts','volt',
    // Tamanhos de roupas e calçados
    'tamanho','tam','numero','tamanhos',
    'pp','ppp','gg','ggg','xg','xxg','xs','xxs','xl','xxl','xgg',
    '34','35','36','37','38','39','40','41','42','43','44','45','46','47','48',
    // Materiais comuns
    'couro','sintetico','sintetica','tecido','algodao','poliester','nylon','borracha',
  ]);
  const words = productName
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w))
    .map(w => SYNONYMS[w] ?? w);
  const seen = new Set<string>();
  const unique = words.filter(w => { if (seen.has(w)) return false; seen.add(w); return true; });
  return unique.slice(0, 3).join(' ');
}

export async function lookupNcmBySku(sku: string, name?: string, ean?: string) {
  if (!sku || sku.trim() === '' || sku === '-') {
    return { sku, ncm: null, origem: null, cest: null, source: 'not_found' as const };
  }

  // 1. Banco interno (cache)
  const db = await getDb();
  if (db) {
    const rows = await db.select().from(ncmCache).where(inArray(ncmCache.sku, [sku]));
    const validRow = rows.find((r) => r.ncm && r.ncm.trim() !== '' && r.ncm !== '0000.00.00');
    if (validRow) {
      return { sku, ncm: validRow.ncm, origem: validRow.origem, cest: validRow.cest, source: 'cache' as const };
    }
  }

  // 2. Buscar por SKU exato em todas as contas Bling
  const accounts = await getBlingAccountsByUserId(OWNER_USER_ID);
  for (const account of accounts) {
    try {
      const product = await getProductBySku(account, sku);
      const rawNcm = product?.tributacao?.ncm;
      if (isValidNcm(rawNcm)) {
        const ncm = String(rawNcm).trim();
        const origem = product?.tributacao?.origem ?? null;
        const cest = product?.tributacao?.cest ?? null;
        await upsertNcmCacheBySku({ accountId: account.id, sku, ncm, origem, cest }).catch(() => {});
        return { sku, ncm, origem, cest, source: 'bling' as const };
      }
    } catch {
      // Conta bloqueada ou erro — tentar próxima
    }
  }

  // 3. Buscar por EAN/GTIN
  if (ean && ean.trim() !== '' && ean.length >= 8) {
    for (const account of accounts) {
      try {
        const product = await getProductByEan(account, ean.trim());
        const rawNcm = product?.tributacao?.ncm;
        if (isValidNcm(rawNcm)) {
          const ncm = String(rawNcm).trim();
          const origem = product?.tributacao?.origem ?? null;
          const cest = product?.tributacao?.cest ?? null;
          await upsertNcmCacheBySku({ accountId: account.id, sku, ncm, origem, cest }).catch(() => {});
          return { sku, ncm, origem, cest, source: 'bling' as const };
        }
      } catch {
        // Conta bloqueada ou erro — tentar próxima
      }
    }
  }

  // 4. Buscar por nome do produto
  if (name && name.trim() !== '') {
    const nameKeywords = extractKeywords(name);
    const searchName = nameKeywords.length > 0 ? nameKeywords.split(' ').slice(0, 2).join(' ') : name.trim().split(' ').slice(0, 2).join(' ');
    for (const account of accounts) {
      try {
        const product = await getProductByName(account, searchName);
        const rawNcm = product?.tributacao?.ncm;
        if (isValidNcm(rawNcm)) {
          const ncm = String(rawNcm).trim();
          const origem = product?.tributacao?.origem ?? null;
          const cest = product?.tributacao?.cest ?? null;
          await upsertNcmCacheBySku({ accountId: account.id, sku, ncm, origem, cest }).catch(() => {});
          return { sku, ncm, origem, cest, source: 'bling_name' as const };
        }
      } catch {
        // Conta bloqueada ou erro — tentar próxima
      }
    }
  }

  // 5. NCM direto por categoria
  if (name && name.trim() !== '') {
    const directNcm = lookupDirectNcm(name);
    if (directNcm) {
      await upsertNcmCacheBySku({ accountId: 0, sku, ncm: directNcm, origem: null, cest: null }).catch(() => {});
      return { sku, ncm: directNcm, origem: null, cest: null, source: 'brasilapi' as const };
    }
  }

  // 6. BrasilAPI
  if (name && name.trim() !== '') {
    try {
      const keywords = extractKeywords(name);
      const keywordList = keywords.split(' ').filter(k => k.length > 2);
      for (const keyword of keywordList) {
        const brasilRes = await fetch(`https://brasilapi.com.br/api/ncm/v1?search=${encodeURIComponent(keyword)}`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (brasilRes.ok) {
          const brasilData = await brasilRes.json() as Array<{ codigo: string; descricao: string }>;
          const validEntries = brasilData?.filter(r => r.codigo && /^\d{4}\.\d{2}\.\d{2}$/.test(r.codigo.trim()));
          const first = validEntries?.[0];
          if (first?.codigo) {
            const ncm = first.codigo.trim();
            await upsertNcmCacheBySku({ accountId: 0, sku, ncm, origem: null, cest: null }).catch(() => {});
            return { sku, ncm, origem: null, cest: null, source: 'brasilapi' as const };
          }
        }
      }
    } catch {
      // BrasilAPI indisponível — continuar sem NCM
    }
  }

  return { sku, ncm: null, origem: null, cest: null, source: 'not_found' as const };
}
