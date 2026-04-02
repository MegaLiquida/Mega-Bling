import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getMagis5OrdersByDate,
  extractProductsFromMagis5Orders,
} from "./magis5Service";
import {
  getBlingAccountsByUserId,
  getBlingAccountById,
  createBlingAccount,
  deleteBlingAccount,
  createSyncHistory,
  getSyncHistoryByUserId,
  updateBlingAccountCnpj,
  updateBlingToken,
  getNcmFromCacheBySku,
  upsertNcmCacheBySku,
} from "./db";
import {
  getOrdersByDate,
  extractProductsFromOrders,
  createSaleNFe,
  getValidToken,
  getContactByCnpj,
  createContactFromCnpj,
  ensureProductsInDestAccount,
  getProductBySku,
  getAccountBlockStatus,
  getAllBlockStatuses,
  markAccountBlocked,
} from "./blingService";

// ID fixo do owner — não requer autenticação
const OWNER_USER_ID = 1;

// ─── Bling Accounts Router ────────────────────────────────────────────────────

const blingRouter = router({
  // List all accounts
  listAccounts: publicProcedure.query(async () => {
    const accounts = await getBlingAccountsByUserId(OWNER_USER_ID);
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      cnpj: a.cnpj,
      hasToken: !!a.accessToken,
      tokenExpiresAt: a.tokenExpiresAt,
    }));
  }),

  // Add a new Bling account
  addAccount: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        clientId: z.string().min(1),
        clientSecret: z.string().min(1),
        cnpj: z.string().optional(),
        accessToken: z.string().optional(),
        refreshToken: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await createBlingAccount({
        userId: OWNER_USER_ID,
        name: input.name,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        cnpj: input.cnpj,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
      });
      return { success: true };
    }),

  // Delete a Bling account
  deleteAccount: publicProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input }) => {
      await deleteBlingAccount(input.accountId, OWNER_USER_ID);
      return { success: true };
    }),

  // Get OAuth authorization URL for a Bling account
  getAuthUrl: publicProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input }) => {
      const account = await getBlingAccountById(input.accountId);
      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });
      }
      const redirectUri = `${process.env.OAUTH_SERVER_URL ?? ""}/api/bling/callback`;
      const state = Buffer.from(
        JSON.stringify({ accountId: account.id, userId: OWNER_USER_ID })
      ).toString("base64");
      const url = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${account.clientId}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
      return { url };
    }),

  // Check token status for all accounts
  checkTokens: publicProcedure.query(async () => {
    const accounts = await getBlingAccountsByUserId(OWNER_USER_ID);
    const results = await Promise.all(
      accounts.map(async (a) => {
        try {
          await getValidToken(a);
          return { id: a.id, name: a.name, status: "ok" as const };
        } catch {
          return { id: a.id, name: a.name, status: "error" as const };
        }
      })
    );
    return results;
  }),

  // Retorna status de bloqueio Cloudflare de todas as contas
  getAccountsStatus: publicProcedure.query(async () => {
    const accounts = await getBlingAccountsByUserId(OWNER_USER_ID);
    return accounts.map((a) => {
      const blockStatus = getAccountBlockStatus(a.id);
      return {
        id: a.id,
        name: a.name,
        cnpj: a.cnpj,
        hasToken: !!a.accessToken,
        tokenExpiresAt: a.tokenExpiresAt,
        blocked: blockStatus.blocked,
        blockedAt: blockStatus.blockedAt,
        unblocksAt: blockStatus.unblocksAt,
        remainingMs: blockStatus.remainingMs,
      };
    });
  }),

  // Fetch products from orders on a given date
  fetchOrderProducts: publicProcedure
    .input(
      z.object({
        accountId: z.number(),
        date: z.string(), // YYYY-MM-DD
      })
    )
    .mutation(async ({ input }) => {
      const account = await getBlingAccountById(input.accountId);
      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });
      }

      let orders: any[];
      try {
        orders = await getOrdersByDate(account, input.date);
      } catch (err: any) {
        const msg: string = err?.message ?? "";
        if (msg.includes("403") || msg.includes("Cloudflare") || msg.includes("Acesso bloqueado")) {
          // Registrar bloqueio para exibir contador na UI
          markAccountBlocked(input.accountId);
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "CLOUDFLARE_BLOCKED: A API do Bling está temporariamente bloqueada pelo Cloudflare. Aguarde 30-60 minutos e tente novamente.",
          });
        }
        throw err;
      }

      if (orders.length === 0) {
        return { products: [], orderCount: 0 };
      }

      const products = await extractProductsFromOrders(account, orders);
      return { products, orderCount: orders.length };
    }),

  // Check and ensure products exist in destination account
  checkProductsInDest: publicProcedure
    .input(
      z.object({
        sourceAccountId: z.number(),
        destAccountId: z.number(),
        items: z.array(
          z.object({
            productId: z.number(),
            sku: z.string(),
            name: z.string(),
            unit: z.string().optional(),
            ncm: z.string().optional(),
            origem: z.number().optional(),
            cest: z.string().optional(),
            price: z.number(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const sourceAccount = await getBlingAccountById(input.sourceAccountId);
      const destAccount = await getBlingAccountById(input.destAccountId);

      if (!sourceAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta de origem não encontrada" });
      }
      if (!destAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta de destino não encontrada" });
      }

      const results = await ensureProductsInDestAccount(sourceAccount, destAccount, input.items);
      return results; // Array de { sku, action: "found" | "created", destProductId? }
    }),

  // Check and ensure a SINGLE product exists in destination account (usado para verificação item a item)
  checkSingleProduct: publicProcedure
    .input(
      z.object({
        sourceAccountId: z.number(),
        destAccountId: z.number(),
        item: z.object({
          productId: z.number(),
          sku: z.string(),
          name: z.string(),
          unit: z.string().optional(),
          ncm: z.string().optional(),
          origem: z.number().optional(),
          cest: z.string().optional(),
          price: z.number(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const sourceAccount = await getBlingAccountById(input.sourceAccountId);
      const destAccount = await getBlingAccountById(input.destAccountId);

      if (!sourceAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta de origem não encontrada" });
      }
      if (!destAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta de destino não encontrada" });
      }

      const results = await ensureProductsInDestAccount(sourceAccount, destAccount, [input.item]);
      return results[0] ?? { sku: input.item.sku, action: "found" as const };
    }),

  // Send sale NFe to destination account
  sendSaleNFe: publicProcedure
    .input(
      z.object({
        sourceAccountId: z.number(),
        destAccountId: z.number(),       // conta emissora (quem emite a nota)
        receiverAccountId: z.number(),   // conta destinatária (quem recebe a nota)
        syncDate: z.string(),
        items: z.array(
          z.object({
            productId: z.number(),
            sku: z.string(),
            name: z.string(),
            quantity: z.number(),
            price: z.number(),
            unit: z.string().optional(),
            ncm: z.string().optional(),
            origem: z.number().optional(),
            cest: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      // destAccountId = conta emissora (quem emite a NFe)
      // receiverAccountId = conta destinatária (cujo CNPJ será o contato na emissora)
      // receiverAccountId = -1 significa Magis5 (Mega Facility)
      const sourceAccount = await getBlingAccountById(input.sourceAccountId);
      const emitterAccount = await getBlingAccountById(input.destAccountId);

      // Verificar se o destinatário é o Magis5
      const isMagis5Receiver = input.receiverAccountId === -1;
      const receiverAccount = isMagis5Receiver
        ? { id: -1, name: "Magis5 (Mega Facility SP Ltda)", cnpj: "57052820000144", hasToken: true, tokenExpiresAt: null }
        : await getBlingAccountById(input.receiverAccountId);

      if (!sourceAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta de origem não encontrada" });
      }
      if (!emitterAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta emissora não encontrada" });
      }
      if (!receiverAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conta destinatária não encontrada" });
      }

      const nfeItems = input.items.map((item) => ({
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        unit: (item.unit || "UN").trim() || "UN",
        ncm: item.ncm,
        origem: item.origem,
        cest: item.cest,
      }));

      console.log("[sendSaleNFe] Itens montados para NFe:", JSON.stringify(nfeItems, null, 2));

      // O CNPJ do destinatário é o da conta receptora
      const receiverCnpj = receiverAccount.cnpj ?? undefined;
      console.log(`[sendSaleNFe] Emissora: ${emitterAccount.name} | Destinatária: ${receiverAccount.name} | CNPJ destinatária: ${receiverCnpj}`);

      let contactId: number;
      let contactName: string;

      if (receiverCnpj) {
        // Buscar o contato da conta destinatária dentro da conta emissora
        let contact = await getContactByCnpj(emitterAccount, receiverCnpj);
        if (!contact) {
          console.log(`[sendSaleNFe] Contato com CNPJ ${receiverCnpj} não encontrado na emissora. Criando automaticamente...`);
          const created = await createContactFromCnpj(emitterAccount, receiverCnpj);
          contactId = created.id;
          contactName = created.nome;
          console.log(`[sendSaleNFe] Contato criado: ${contactName} (ID: ${contactId})`);
        } else {
          contactId = contact.id;
          contactName = contact.nome ?? contact.fantasia ?? "";
          console.log(`[sendSaleNFe] Contato encontrado: ${contactName} (ID: ${contactId})`);
        }
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "CNPJ da conta destinatária não configurado. Edite a conta e informe o CNPJ.",
        });
      }

      // Produtos já verificados/cadastrados no Step 3 (painel de verificação)
      console.log(`[sendSaleNFe] Enviando NFe com ${nfeItems.length} produto(s)...`);

      let nfeResult: any;
      try {
        nfeResult = await createSaleNFe(emitterAccount, contactId, contactName, nfeItems, receiverCnpj);
      } catch (err: any) {
        await createSyncHistory({
          userId: OWNER_USER_ID,
          sourceAccountId: input.sourceAccountId,
          destAccountId: input.destAccountId,
          syncDate: input.syncDate,
          status: "error",
          totalItems: input.items.length,
          errorMessage: err.message,
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }

      const totalValue = input.items
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
        .toFixed(2);

      await createSyncHistory({
        userId: OWNER_USER_ID,
        sourceAccountId: input.sourceAccountId,
        destAccountId: input.destAccountId,
        syncDate: input.syncDate,
        status: "success",
        nfeId: String(nfeResult?.id ?? ""),
        nfeNumber: String(nfeResult?.numero ?? ""),
        totalItems: input.items.length,
        totalValue,
      });

      return {
        success: true,
        nfeId: nfeResult?.id,
        nfeNumber: nfeResult?.numero,
        totalValue,
      };
    }),

  // Diagnóstico: inspecionar XML da NFe de pedidos Magis5 para depurar NCM
  diagMagis5NfeXml: publicProcedure
    .input(z.object({ date: z.string() }))
    .mutation(async ({ input }) => {
      const apiKey = process.env.MAGIS5_API_KEY;
      if (!apiKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "MAGIS5_API_KEY não configurado" });

      const orders = await getMagis5OrdersByDate(apiKey, input.date);
      const results: any[] = [];

      for (const order of orders.slice(0, 5)) { // Limitar a 5 pedidos
        const invoices: any[] = order.invoices ?? [];
        const xmlUrl: string = invoices[0]?.urlXml ?? "";
        const items: any[] = order.order_items ?? [];

        let xmlSample = "";
        if (xmlUrl) {
          try {
            const { default: axios } = await import("axios");
            const resp = await axios.get(xmlUrl, { timeout: 10000, responseType: "text" });
            const xml: string = resp.data;
            // Extrair apenas o primeiro bloco <det> para análise
            const firstDet = xml.match(/<det[^>]*>[\s\S]*?<\/det>/)?.[0] ?? "";
            // Extrair campos relevantes
            const cEAN = firstDet.match(/<cEAN>(.*?)<\/cEAN>/)?.[1] ?? "N/A";
            const cEANTrib = firstDet.match(/<cEANTrib>(.*?)<\/cEANTrib>/)?.[1] ?? "N/A";
            const cProd = firstDet.match(/<cProd>(.*?)<\/cProd>/)?.[1] ?? "N/A";
            const NCM = firstDet.match(/<NCM>(.*?)<\/NCM>/)?.[1] ?? "N/A";
            const xProd = firstDet.match(/<xProd>(.*?)<\/xProd>/)?.[1] ?? "N/A";
            xmlSample = JSON.stringify({ cEAN, cEANTrib, cProd, NCM, xProd });
          } catch (e: any) {
            xmlSample = `Erro ao baixar XML: ${e.message}`;
          }
        }

        const firstItem = items[0]?.item ?? {};
        results.push({
          orderId: order.id,
          xmlUrl,
          xmlFirstDet: xmlSample,
          itemEan: firstItem.ean ?? "N/A",
          itemSku: firstItem.seller_custom_field ?? "N/A",
          itemTitle: firstItem.title ?? "N/A",
        });
      }

      return results;
    }),

  // Fetch products from Magis5 billed orders on a given date
  fetchMagis5Products: publicProcedure
    .input(
      z.object({
        date: z.string(), // YYYY-MM-DD
        sourceAccountId: z.number().optional(), // Conta Bling emissora para fallback de NCM
      })
    )
    .mutation(async ({ input }) => {
      const apiKey = process.env.MAGIS5_API_KEY;
      if (!apiKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Token do Magis5 não configurado. Configure MAGIS5_API_KEY nas variáveis de ambiente.",
        });
      }

      const orders = await getMagis5OrdersByDate(apiKey, input.date);
      if (orders.length === 0) {
        return { products: [], orderCount: 0 };
      }

      const products = await extractProductsFromMagis5Orders(orders);

      // Salvar no cache os NCMs já encontrados pelo XML (para não depender do Bling nas próximas vezes)
      if (input.sourceAccountId) {
        const accountsForCache = await getBlingAccountsByUserId(OWNER_USER_ID);
        const sourceAccountForCache = accountsForCache.find(a => a.id === input.sourceAccountId);
        if (sourceAccountForCache) {
          const productsWithNcm = products.filter(p => p.ncm);
          for (const product of productsWithNcm) {
            await upsertNcmCacheBySku({
              accountId: sourceAccountForCache.id,
              sku: product.sku,
              ncm: product.ncm,
            }).catch(() => {});
          }
          if (productsWithNcm.length > 0) {
            console.log(`[fetchMagis5Products] ${productsWithNcm.length} NCMs salvos no cache do banco.`);
          }
        }
      }

      // Fallback: buscar NCM via cache do banco ou via API do Bling
      if (input.sourceAccountId) {
        const accounts = await getBlingAccountsByUserId(OWNER_USER_ID);
        const sourceAccount = accounts.find(a => a.id === input.sourceAccountId);
        if (sourceAccount) {
          // Passo 1: consultar cache do banco para produtos sem NCM
          const missingNcm = products.filter(p => !p.ncm);
          for (const product of missingNcm) {
            const cached = await getNcmFromCacheBySku(sourceAccount.id, product.sku);
            if (cached?.ncm) {
              product.ncm = cached.ncm;
              console.log(`[fetchMagis5Products] NCM encontrado no cache para ${product.sku}: ${product.ncm}`);
            }
          }

          // Passo 2: para os que ainda não têm NCM, tentar via API do Bling
          const stillMissingNcm = products.filter(p => !p.ncm);
          if (stillMissingNcm.length > 0) {
            console.log(`[fetchMagis5Products] Buscando NCM via Bling para ${stillMissingNcm.length} produtos sem NCM no cache...`);
            let blingBlocked = false;
            for (const product of stillMissingNcm) {
              if (blingBlocked) break; // Parar imediatamente se Cloudflare bloqueou
              try {
                await new Promise(r => setTimeout(r, 400)); // Respeitar rate limit
                const found = await getProductBySku(sourceAccount, product.sku);
                if (found?.tributacao?.ncm) {
                  const rawNcm = String(found.tributacao.ncm).replace(/\D/g, "");
                  product.ncm = rawNcm.length === 8
                    ? `${rawNcm.slice(0, 4)}.${rawNcm.slice(4, 6)}.${rawNcm.slice(6, 8)}`
                    : found.tributacao.ncm;
                  console.log(`[fetchMagis5Products] NCM encontrado via Bling para ${product.sku}: ${product.ncm}`);
                  // Salvar no cache para próximas sincronizações
                  await upsertNcmCacheBySku({
                    accountId: sourceAccount.id,
                    sku: product.sku,
                    ncm: product.ncm,
                    origem: found.tributacao?.origem ?? null,
                    cest: found.tributacao?.cest ?? null,
                  }).catch(() => {}); // Não bloquear se o cache falhar
                }
              } catch (e: any) {
                console.warn(`[fetchMagis5Products] Falha ao buscar NCM via Bling para ${product.sku}: ${e.message}`);
                // Se for bloqueio Cloudflare (403), parar o loop inteiro
                if (e.message?.includes('403') || e.message?.includes('Cloudflare')) {
                  console.warn(`[fetchMagis5Products] Cloudflare bloqueou a API do Bling. Abortando busca de NCM.`);
                  blingBlocked = true;
                }
              }
            }
          }
        }
      }

      return { products, orderCount: orders.length };
    }),

  // Salvar NCM no cache (para NCMs digitados manualmente pelo usuário)
  saveNcmCache: publicProcedure
    .input(
      z.object({
        accountId: z.number(),
        sku: z.string(),
        ncm: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      if (!input.ncm || input.ncm === "0000.00.00") return { ok: true };
      await upsertNcmCacheBySku({
        accountId: input.accountId,
        sku: input.sku,
        ncm: input.ncm,
      }).catch(() => {});
      return { ok: true };
    }),

  // Get sync history
  getSyncHistory: publicProcedure.query(async () => {
    const history = await getSyncHistoryByUserId(OWNER_USER_ID);
    const accounts = await getBlingAccountsByUserId(OWNER_USER_ID);
    const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

    return history.map((h) => ({
      ...h,
      sourceAccountName: accountMap.get(h.sourceAccountId) ?? `Conta #${h.sourceAccountId}`,
      destAccountName: accountMap.get(h.destAccountId) ?? `Conta #${h.destAccountId}`,
    }));
  }),
});

// ─── Root Router ──────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  bling: blingRouter,
});

export type AppRouter = typeof appRouter;
