#!/usr/bin/env node
/**
 * check_ncm.mjs — Auditoria de produtos sem NCM em todas as contas Bling cadastradas.
 *
 * Uso:
 *   DATABASE_URL="mysql://user:pass@host:3306/db" node scripts/check_ncm.mjs
 *
 * O script conecta diretamente ao banco de dados, lê todas as contas Bling,
 * e verifica quais produtos não têm NCM cadastrado via API Bling v3.
 */

import mysql from "mysql2/promise";
import axios from "axios";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌  Variável DATABASE_URL não definida.");
  process.exit(1);
}

const BLING_API = "https://api.bling.com.br/v3";
const BLING_TOKEN_URL = "https://api.bling.com.br/Api/v3/oauth/token";
const DELAY_MS = 350;
const BATCH_SIZE = 5;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function blingGet(url, token, params = {}) {
  await sleep(DELAY_MS);
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    params,
  });
  return response.data;
}

async function refreshToken(account, conn) {
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
  await conn.execute(
    "UPDATE bling_accounts SET accessToken=?, refreshToken=?, tokenExpiresAt=? WHERE id=?",
    [access_token, refresh_token, expiresAt, account.id]
  );
  return access_token;
}

async function getValidToken(account, conn) {
  const now = new Date();
  const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
  const bufferMs = 5 * 60 * 1000;
  if (!expiresAt || expiresAt.getTime() - now.getTime() < bufferMs) {
    return refreshToken(account, conn);
  }
  return account.accessToken;
}

async function getAllProducts(token) {
  let allProducts = [];
  let page = 1;
  const limite = 100;

  while (true) {
    const data = await blingGet(`${BLING_API}/produtos`, token, { pagina: page, limite });
    const items = data?.data ?? [];
    allProducts = allProducts.concat(items);
    if (items.length < limite) break;
    page++;
  }
  return allProducts;
}

async function getProductDetail(token, productId) {
  const data = await blingGet(`${BLING_API}/produtos/${productId}`, token);
  return data?.data;
}

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);

  try {
    const [accounts] = await conn.execute(
      "SELECT id, name, cnpj, clientId, clientSecret, accessToken, refreshToken, tokenExpiresAt FROM bling_accounts"
    );

    if (accounts.length === 0) {
      console.log("Nenhuma conta Bling cadastrada.");
      return;
    }

    console.log(`\n📋  Verificando ${accounts.length} conta(s) Bling...\n`);

    const report = [];

    for (const account of accounts) {
      console.log(`\n🔍  Conta: ${account.name} (ID: ${account.id})`);

      let token;
      try {
        token = await getValidToken(account, conn);
      } catch (err) {
        console.error(`  ❌  Erro ao obter token: ${err.message}`);
        continue;
      }

      let allProducts;
      try {
        allProducts = await getAllProducts(token);
        console.log(`  📦  ${allProducts.length} produto(s) encontrado(s)`);
      } catch (err) {
        console.error(`  ❌  Erro ao listar produtos: ${err.message}`);
        continue;
      }

      const withoutNcm = [];

      for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
        const batch = allProducts.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (p) => {
            try {
              const detail = await getProductDetail(token, p.id);
              const ncm = detail?.tributacao?.ncm;
              if (!ncm || ncm.trim() === "") {
                withoutNcm.push({
                  id: p.id,
                  codigo: p.codigo ?? "—",
                  nome: p.nome ?? "—",
                });
              }
            } catch (err) {
              console.warn(`  ⚠️  Erro ao verificar produto ${p.id}: ${err.message}`);
            }
          })
        );
        if (i + BATCH_SIZE < allProducts.length) await sleep(500);
      }

      console.log(`  ⚠️   ${withoutNcm.length} produto(s) sem NCM`);
      report.push({ account: account.name, total: allProducts.length, withoutNcm });
    }

    console.log("\n\n═══════════════════════════════════════════════════");
    console.log("  RELATÓRIO FINAL — Produtos sem NCM");
    console.log("═══════════════════════════════════════════════════\n");

    for (const r of report) {
      console.log(`Conta: ${r.account} — ${r.withoutNcm.length}/${r.total} sem NCM`);
      if (r.withoutNcm.length > 0) {
        console.table(r.withoutNcm);
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Erro fatal:", err.message);
  process.exit(1);
});
