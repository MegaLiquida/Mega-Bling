import * as XLSX from "xlsx";

export interface ExcelProduct {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  unit: string;
  ncm: string;
  origem: string;
  cest: string;
  productId: number;
}

/**
 * Parser para planilhas Excel com colunas: SKU, Nome, Quantidade, Valor
 * Aceita variações de case e acentos nos cabeçalhos.
 */
export function readExcelProducts(file: File): Promise<ExcelProduct[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });

        if (rows.length === 0) {
          reject(new Error("Planilha vazia ou sem dados."));
          return;
        }

        // Detectar cabeçalhos com flexibilidade
        const headers = Object.keys(rows[0]);
        const headerMap = findHeaders(headers);

        if (!headerMap.sku || !headerMap.name || !headerMap.quantity || !headerMap.price) {
          reject(
            new Error(
              `Colunas não encontradas. Esperado: SKU, Nome, Quantidade, Valor. Encontrado: ${headers.join(", ")}`
            )
          );
          return;
        }

        const products: ExcelProduct[] = rows
          .map((row) => {
            const sku = String(row[headerMap.sku!] ?? "").trim();
            const name = String(row[headerMap.name!] ?? "").trim();
            const quantityRaw = row[headerMap.quantity!];
            const priceRaw = row[headerMap.price!];

            const quantity = parseNumber(quantityRaw);
            const price = parseNumber(priceRaw);

            return {
              sku,
              name,
              quantity,
              price,
              unit: "UN",
              ncm: "",
              origem: "0",
              cest: "",
              productId: 0,
            };
          })
          .filter((p) => p.sku !== "" && p.name !== "" && p.quantity > 0);

        // Remover duplicatas por SKU, somando quantidades
        const skuMap = new Map<string, ExcelProduct>();
        for (const p of products) {
          const existing = skuMap.get(p.sku);
          if (existing) {
            existing.quantity += p.quantity;
          } else {
            skuMap.set(p.sku, { ...p });
          }
        }

        resolve(Array.from(skuMap.values()));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Erro ao processar planilha."));
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler o arquivo."));
    reader.readAsArrayBuffer(file);
  });
}

function parseNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val
      .replace(/[R$\s.]/g, "")
      .replace(",", ".")
      .trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Mapeia cabeçalhos com flexibilidade (case, acentos, variações)
 */
function findHeaders(headers: string[]): {
  sku?: string;
  name?: string;
  quantity?: string;
  price?: string;
} {
  const result: { sku?: string; name?: string; quantity?: string; price?: string } = {};

  for (const h of headers) {
    const normalized = h
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    if (!result.sku && (normalized === "sku" || normalized === "codigo" || normalized === "código" || normalized === "cod")) {
      result.sku = h;
    }
    if (!result.name && (normalized === "nome" || normalized === "nome produto" || normalized === "descri" || normalized.includes("nome"))) {
      result.name = h;
    }
    if (!result.quantity && (normalized === "quantidade" || normalized === "qtd" || normalized === "qtde" || normalized === "qty")) {
      result.quantity = h;
    }
    if (!result.price && (normalized === "valor" || normalized === "preco" || normalized === "preço" || normalized === "unit" || normalized === "preço unitário")) {
      result.price = h;
    }
  }

  return result;
}
