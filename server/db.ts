import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  type BlingAccount,
  type InsertUser,
  type NcmCache,
  type SyncHistory,
  blingAccounts,
  ncmCache,
  syncHistory,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

function shouldUseSsl(connectionString: string): boolean {
  if (process.env.DATABASE_SSL === "true") return true;
  if (process.env.DATABASE_SSL === "false") return false;
  return connectionString.includes("render.com");
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const connectionString = process.env.DATABASE_URL;
      _pool = new Pool({
        connectionString,
        ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
      });
      _db = drizzle({ client: _pool });
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = { updatedAt: new Date() };

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (!values.updatedAt) values.updatedAt = new Date();
  if (Object.keys(updateSet).length === 1) updateSet.lastSignedIn = new Date();

  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Bling Accounts ───────────────────────────────────────────────────────────

export async function getBlingAccountsByUserId(userId: number): Promise<BlingAccount[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(blingAccounts).where(eq(blingAccounts.userId, userId));
}

export async function getBlingAccountById(id: number): Promise<BlingAccount | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(blingAccounts).where(eq(blingAccounts.id, id)).limit(1);
  return result[0];
}

export async function createBlingAccount(data: {
  userId: number;
  name: string;
  cnpj?: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(blingAccounts).values({
    userId: data.userId,
    name: data.name,
    cnpj: data.cnpj ?? null,
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    accessToken: data.accessToken ?? "",
    refreshToken: data.refreshToken ?? "",
    updatedAt: new Date(),
  });
}

export async function updateBlingToken(
  id: number,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(blingAccounts)
    .set({ accessToken, refreshToken, tokenExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(blingAccounts.id, id));
}

export async function updateBlingAccountCredentials(data: {
  id: number;
  userId: number;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(blingAccounts)
    .set({
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenExpiresAt: data.tokenExpiresAt,
      updatedAt: new Date(),
    })
    .where(and(eq(blingAccounts.id, data.id), eq(blingAccounts.userId, data.userId)));
}

export async function getAllBlingAccounts(): Promise<BlingAccount[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(blingAccounts);
}

export async function deleteBlingAccount(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(blingAccounts).where(and(eq(blingAccounts.id, id), eq(blingAccounts.userId, userId)));
}

export async function updateBlingAccountCnpj(id: number, cnpj: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(blingAccounts).set({ cnpj, updatedAt: new Date() }).where(eq(blingAccounts.id, id));
}

// ─── Sync History ─────────────────────────────────────────────────────────────

export async function createSyncHistory(data: {
  userId: number;
  sourceAccountId: number;
  destAccountId: number;
  syncDate: string;
  status: "success" | "error" | "partial";
  nfeId?: string;
  nfeNumber?: string;
  totalItems?: number;
  totalValue?: string;
  errorMessage?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(syncHistory).values({
    userId: data.userId,
    sourceAccountId: data.sourceAccountId,
    destAccountId: data.destAccountId,
    syncDate: data.syncDate,
    status: data.status,
    nfeId: data.nfeId ?? null,
    nfeNumber: data.nfeNumber ?? null,
    totalItems: data.totalItems ?? 0,
    totalValue: data.totalValue ?? null,
    errorMessage: data.errorMessage ?? null,
  });
}

export async function getSyncHistoryByUserId(userId: number): Promise<SyncHistory[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(syncHistory)
    .where(eq(syncHistory.userId, userId))
    .orderBy(desc(syncHistory.createdAt))
    .limit(50);
}

// ─── NCM Cache ────────────────────────────────────────────────────────────────

export async function getNcmFromCache(
  accountId: number,
  productId: number
): Promise<NcmCache | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(ncmCache)
    .where(and(eq(ncmCache.accountId, accountId), eq(ncmCache.productId, productId)))
    .limit(1);
  return result[0];
}

// Busca NCM por SKU (para produtos do Magis5 que não têm productId do Bling)
export async function getNcmFromCacheBySku(
  accountId: number,
  sku: string
): Promise<NcmCache | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(ncmCache)
    .where(and(eq(ncmCache.accountId, accountId), eq(ncmCache.sku, sku)))
    .limit(1);
  return result[0];
}

// Salva NCM por SKU (para produtos do Magis5 sem productId do Bling)
export async function upsertNcmCacheBySku(data: {
  accountId: number;
  sku: string;
  ncm?: string | null;
  origem?: number | null;
  cest?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // productId fica null para produtos sem ID Bling (ex: Magis5)
  await db
    .insert(ncmCache)
    .values({
      accountId: data.accountId,
      productId: null,
      sku: data.sku,
      ncm: data.ncm ?? null,
      origem: data.origem ?? null,
      cest: data.cest ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [ncmCache.accountId, ncmCache.sku],
      set: {
        ncm: data.ncm ?? null,
        origem: data.origem ?? null,
        cest: data.cest ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function upsertNcmCache(data: {
  accountId: number;
  productId?: number | null;
  sku: string;
  ncm?: string | null;
  origem?: number | null;
  cest?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // O índice UNIQUE é por (accountId, sku) — funciona para todos os produtos
  await db
    .insert(ncmCache)
    .values({
      accountId: data.accountId,
      productId: data.productId ?? null,
      sku: data.sku,
      ncm: data.ncm ?? null,
      origem: data.origem ?? null,
      cest: data.cest ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [ncmCache.accountId, ncmCache.sku],
      set: {
        productId: data.productId ?? null,
        ncm: data.ncm ?? null,
        origem: data.origem ?? null,
        cest: data.cest ?? null,
        updatedAt: new Date(),
      },
    });
}
