import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const syncStatusEnum = pgEnum("sync_status", ["success", "error", "partial"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Bling Accounts ───────────────────────────────────────────────────────────

export const blingAccounts = pgTable("bling_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  cnpj: varchar("cnpj", { length: 20 }),
  clientId: varchar("clientId", { length: 255 }).notNull(),
  clientSecret: varchar("clientSecret", { length: 255 }).notNull(),
  accessToken: text("accessToken").notNull().default(""),
  refreshToken: text("refreshToken").notNull().default(""),
  tokenExpiresAt: timestamp("tokenExpiresAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

export type BlingAccount = typeof blingAccounts.$inferSelect;
export type InsertBlingAccount = typeof blingAccounts.$inferInsert;

// ─── Sync History ─────────────────────────────────────────────────────────────

export const syncHistory = pgTable("sync_history", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  sourceAccountId: integer("sourceAccountId").notNull(),
  destAccountId: integer("destAccountId").notNull(),
  syncDate: varchar("syncDate", { length: 10 }).notNull(), // YYYY-MM-DD
  status: syncStatusEnum("status").notNull(),
  nfeId: varchar("nfeId", { length: 64 }),
  nfeNumber: varchar("nfeNumber", { length: 64 }),
  totalItems: integer("totalItems").default(0),
  totalValue: numeric("totalValue", { precision: 12, scale: 2 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export type SyncHistory = typeof syncHistory.$inferSelect;
export type InsertSyncHistory = typeof syncHistory.$inferInsert;

// ─── NCM Cache ────────────────────────────────────────────────────────────────
// Armazena NCM, origem e CEST buscados do Bling para evitar chamadas repetidas

export const ncmCache = pgTable(
  "ncm_cache",
  {
    id: serial("id").primaryKey(),
    accountId: integer("accountId").notNull(),
    productId: integer("productId"), // null para produtos sem ID Bling (ex: Magis5)
    sku: varchar("sku", { length: 255 }).notNull(),
    ncm: varchar("ncm", { length: 20 }),
    origem: integer("origem"),
    cest: varchar("cest", { length: 20 }),
    updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    // Índice único por conta + SKU (funciona para todos os produtos)
    accountSkuIdx: uniqueIndex("ncm_cache_account_sku_idx").on(table.accountId, table.sku),
  })
);

export type NcmCache = typeof ncmCache.$inferSelect;
export type InsertNcmCache = typeof ncmCache.$inferInsert;
