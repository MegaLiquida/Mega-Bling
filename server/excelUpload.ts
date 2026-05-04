import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];
    const ext = file.originalname.toLowerCase();
    if (allowed.includes(file.mimetype) || ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
      cb(null, true);
    } else {
      cb(new Error("Apenas arquivos .xlsx ou .xls são aceitos."));
    }
  },
});

export interface ExcelProduct {
  sku: string;
  name: string;
  quantity: number;
  price: number;
  ean?: string; // EAN/GTIN/código de barras (opcional)
}

export function registerExcelUploadRoute(app: Router) {
  app.post("/api/excel-upload", upload.single("file"), (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Nenhum arquivo enviado." });
        return;
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Converter para array de objetos
      const raw: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (raw.length === 0) {
        res.status(400).json({ error: "A planilha está vazia." });
        return;
      }

      // Detectar colunas de forma flexível (case-insensitive, aceita variações)
      const firstRow = raw[0];
      const keys = Object.keys(firstRow);

      const findCol = (patterns: string[]): string | null => {
        for (const p of patterns) {
          const found = keys.find((k) => k.toLowerCase().includes(p.toLowerCase()));
          if (found) return found;
        }
        return null;
      };

      const skuCol = findCol(["sku", "codigo", "código", "cod", "ref", "referencia", "referência"]);
      const nameCol = findCol(["nome", "name", "descricao", "descrição", "produto", "description"]);
      const qtyCol = findCol(["quantidade", "qtd", "qty", "quantity", "qtde", "quant"]);
      const priceCol = findCol(["valor", "preco", "preço", "price", "value", "vl", "vlr"]);
      const eanCol = findCol(["ean", "gtin", "barcode", "codigo_barras", "código_barras", "codigobarras", "cod_barras", "cód_barras", "barra", "barras"]);

      if (!nameCol) {
        res.status(400).json({ error: "Coluna de nome/descrição não encontrada. Verifique se a planilha tem uma coluna 'Nome' ou 'Descrição'." });
        return;
      }

      if (!qtyCol) {
        res.status(400).json({ error: "Coluna de quantidade não encontrada. Verifique se a planilha tem uma coluna 'Quantidade' ou 'Qtd'." });
        return;
      }

      if (!priceCol) {
        res.status(400).json({ error: "Coluna de valor não encontrada. Verifique se a planilha tem uma coluna 'Valor' ou 'Preço'." });
        return;
      }

      const products: ExcelProduct[] = [];
      const errors: string[] = [];

      raw.forEach((row, idx) => {
        const lineNum = idx + 2; // +2 porque linha 1 é cabeçalho
        const name = String(row[nameCol] ?? "").trim();
        const sku = skuCol ? String(row[skuCol] ?? "").trim() : `EXCEL-${idx + 1}`;
        const qtyRaw = String(row[qtyCol] ?? "").replace(",", ".");
        const priceRaw = String(row[priceCol] ?? "").replace(/[R$\s]/g, "").replace(",", ".");

        if (!name) {
          errors.push(`Linha ${lineNum}: nome vazio, ignorado.`);
          return;
        }

        const quantity = parseFloat(qtyRaw);
        const price = parseFloat(priceRaw);

        if (isNaN(quantity) || quantity <= 0) {
          errors.push(`Linha ${lineNum} (${name}): quantidade inválida "${row[qtyCol]}".`);
          return;
        }

        if (isNaN(price) || price < 0) {
          errors.push(`Linha ${lineNum} (${name}): valor inválido "${row[priceCol]}".`);
          return;
        }

        const ean = eanCol ? String(row[eanCol] ?? "").trim().replace(/\D/g, "") : "";

        products.push({
          sku: sku || `EXCEL-${idx + 1}`,
          name,
          quantity,
          price,
          ...(ean && ean.length >= 8 ? { ean } : {}),
        });
      });

      if (products.length === 0) {
        res.status(400).json({ error: "Nenhum produto válido encontrado na planilha.", details: errors });
        return;
      }

      res.json({ products, warnings: errors, total: products.length });
    } catch (err: any) {
      res.status(500).json({ error: "Erro ao processar planilha: " + err.message });
    }
  });
}
