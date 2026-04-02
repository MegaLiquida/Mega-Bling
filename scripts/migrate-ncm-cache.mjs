import mysql from "mysql2/promise";
import { readFileSync } from "fs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

// Parse mysql URL
const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!match) throw new Error("Invalid DATABASE_URL format");
const [, user, password, host, port, database] = match;

const ssl = url.includes("ssl=") ? { rejectUnauthorized: true } : undefined;

const conn = await mysql.createConnection({
  host,
  port: Number(port),
  user,
  password,
  database,
  ssl,
});

try {
  const sql = `CREATE TABLE IF NOT EXISTS \`ncm_cache\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`accountId\` int NOT NULL,
    \`productId\` int NOT NULL,
    \`sku\` varchar(255) NOT NULL,
    \`ncm\` varchar(20),
    \`origem\` int,
    \`cest\` varchar(20),
    \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`ncm_cache_id\` PRIMARY KEY(\`id\`)
  )`;
  await conn.execute(sql);
  console.log("✅ Tabela ncm_cache criada com sucesso!");
} catch (err) {
  console.error("❌ Erro:", err.message);
} finally {
  await conn.end();
}
