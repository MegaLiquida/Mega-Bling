import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB helpers ──────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getBlingAccountsByUserId: vi.fn(),
  getBlingAccountById: vi.fn(),
  createBlingAccount: vi.fn(),
  deleteBlingAccount: vi.fn(),
  createSyncHistory: vi.fn(),
  getSyncHistoryByUserId: vi.fn(),
  updateBlingAccountCnpj: vi.fn(),
  updateBlingAccountCredentials: vi.fn(),
  updateBlingToken: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  getAllBlingAccounts: vi.fn().mockResolvedValue([]),
}));

// ─── Mock blingService ────────────────────────────────────────────────────────

vi.mock("./blingService", () => ({
  getValidToken: vi.fn().mockResolvedValue("mock-token"),
  refreshBlingToken: vi.fn(),
  getOrdersByDate: vi.fn().mockResolvedValue([]),
  extractProductsFromOrders: vi.fn().mockResolvedValue([]),
  createSaleNFe: vi.fn().mockResolvedValue({ id: 99, numero: "001" }),
  getContactByCnpj: vi.fn().mockResolvedValue({ id: 1, nome: "Contato Teste" }),
  createContactFromCnpj: vi.fn().mockResolvedValue({ id: 42, nome: "Empresa Criada Automaticamente" }),
  ensureProductsInDestAccount: vi.fn().mockResolvedValue([{ sku: "SKU001", action: "found", destProductId: 10 }]),
}));

import * as db from "./db";
import * as blingService from "./blingService";
import { refreshExpiringTokens, resetInvalidRefreshBackoffForTests, startTokenRefreshJob } from "./tokenRefreshJob";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    ...overrides,
  };
}

const mockAccount = {
  id: 1,
  userId: 1,
  name: "Conta Teste",
  cnpj: "12345678000195",
  clientId: "client-id",
  clientSecret: "client-secret",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  tokenExpiresAt: new Date(Date.now() + 3600_000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("bling.listAccounts", () => {
  it("retorna lista de contas do usuário", async () => {
    vi.mocked(db.getBlingAccountsByUserId).mockResolvedValue([mockAccount]);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.listAccounts();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Conta Teste");
    expect(result[0].hasToken).toBe(true);
  });

  it("retorna lista vazia quando não há contas", async () => {
    vi.mocked(db.getBlingAccountsByUserId).mockResolvedValue([]);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.listAccounts();
    expect(result).toHaveLength(0);
  });
});

describe("bling.addAccount", () => {
  it("cria uma nova conta com sucesso", async () => {
    vi.mocked(db.createBlingAccount).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.addAccount({
      name: "Nova Conta",
      clientId: "cid",
      clientSecret: "csecret",
      cnpj: "12345678000195",
    });
    expect(result.success).toBe(true);
    expect(db.createBlingAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Nova Conta", userId: 1 })
    );
  });
});

describe("bling.deleteAccount", () => {
  it("deleta conta existente", async () => {
    vi.mocked(db.deleteBlingAccount).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.deleteAccount({ accountId: 1 });
    expect(result.success).toBe(true);
    expect(db.deleteBlingAccount).toHaveBeenCalledWith(1, 1);
  });
});

describe("bling.updateAccountCredentials", () => {
  it("atualiza credenciais e calcula expiração a partir de expiresIn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00Z"));
    vi.mocked(db.getBlingAccountById).mockResolvedValue(mockAccount);
    vi.mocked(db.updateBlingAccountCredentials).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.updateAccountCredentials({
      accountId: 1,
      clientId: "novo-client-id",
      clientSecret: "novo-client-secret",
      accessToken: "novo-access-token",
      refreshToken: "novo-refresh-token",
      expiresIn: 21600,
    });

    expect(result.success).toBe(true);
    expect(db.updateBlingAccountCredentials).toHaveBeenCalledWith({
      id: 1,
      userId: 1,
      clientId: "novo-client-id",
      clientSecret: "novo-client-secret",
      accessToken: "novo-access-token",
      refreshToken: "novo-refresh-token",
      tokenExpiresAt: new Date("2026-08-31T18:00:00Z"),
    });
    vi.useRealTimers();
  });

  it("rejeita conta inexistente", async () => {
    vi.mocked(db.getBlingAccountById).mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx());

    await expect(
      caller.bling.updateAccountCredentials({
        accountId: 999,
        clientId: "client",
        clientSecret: "secret",
        accessToken: "access",
        refreshToken: "refresh",
      })
    ).rejects.toThrow("Conta não encontrada");
  });
});

describe("bling.fetchOrderProducts", () => {
  it("retorna lista vazia quando não há pedidos", async () => {
    vi.mocked(db.getBlingAccountById).mockResolvedValue(mockAccount);
    vi.mocked(blingService.getOrdersByDate).mockResolvedValue([]);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.fetchOrderProducts({
      accountId: 1,
      date: "2026-03-31",
    });
    expect(result.products).toHaveLength(0);
    expect(result.orderCount).toBe(0);
  });

  it("retorna lista vazia quando conta não tem pedidos na data", async () => {
    vi.mocked(db.getBlingAccountById).mockResolvedValue({ ...mockAccount, userId: 99 });
    vi.mocked(blingService.getOrdersByDate).mockResolvedValue([]);
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.fetchOrderProducts({ accountId: 1, date: "2026-03-31" });
    expect(result.products).toHaveLength(0);
    expect(result.orderCount).toBe(0);
  });
});

describe("bling.getSyncHistory", () => {
  it("retorna histórico com nomes das contas", async () => {
    vi.mocked(db.getSyncHistoryByUserId).mockResolvedValue([
      {
        id: 1,
        userId: 1,
        sourceAccountId: 1,
        destAccountId: 2,
        syncDate: "2026-03-31",
        status: "success",
        nfeId: "123",
        nfeNumber: "001",
        totalItems: 3,
        totalValue: "150.00",
        errorMessage: null,
        createdAt: new Date(),
      },
    ]);
    vi.mocked(db.getBlingAccountsByUserId).mockResolvedValue([
      mockAccount,
      { ...mockAccount, id: 2, name: "Conta Destino" },
    ]);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.getSyncHistory();
    expect(result).toHaveLength(1);
    expect(result[0].sourceAccountName).toBe("Conta Teste");
    expect(result[0].destAccountName).toBe("Conta Destino");
  });
});

describe("bling.sendSaleNFe - criação automática de contato", () => {
  const saleInput = {
    sourceAccountId: 1,
    destAccountId: 2,       // conta emissora
    receiverAccountId: 3,   // conta destinatária
    syncDate: "2026-03-31",
    items: [
      {
        productId: 10,
        sku: "SKU001",
        name: "Produto Teste",
        quantity: 1,
        price: 100,
        unit: "UN",
        ncm: "8471.30.19",
        origem: 0,
        cest: "",
      },
    ],
  };

  const mockEmitterAccount = { ...mockAccount, id: 2, name: "Conta Emissora" };
  const mockReceiverAccount = { ...mockAccount, id: 3, name: "Conta Destinatária", cnpj: "12345678000199" };

  beforeEach(() => {
    vi.mocked(db.createSyncHistory).mockResolvedValue(undefined);
    vi.mocked(db.updateBlingAccountCnpj).mockResolvedValue(undefined);
    vi.mocked(blingService.createSaleNFe).mockResolvedValue({ id: 99, numero: "001" });
  });

  it("usa contato existente quando encontrado pelo CNPJ", async () => {
    vi.mocked(db.getBlingAccountById)
      .mockResolvedValueOnce(mockAccount)        // sourceAccount
      .mockResolvedValueOnce(mockEmitterAccount) // emitterAccount
      .mockResolvedValueOnce(mockReceiverAccount); // receiverAccount
    vi.mocked(blingService.getContactByCnpj).mockResolvedValue({ id: 1, nome: "Contato Existente" });

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.sendSaleNFe(saleInput);
    expect(result.success).toBe(true);
    expect(blingService.createContactFromCnpj).not.toHaveBeenCalled();
  });

  it("cria contato automaticamente quando não encontrado pelo CNPJ", async () => {
    vi.mocked(db.getBlingAccountById)
      .mockResolvedValueOnce(mockAccount)        // sourceAccount
      .mockResolvedValueOnce(mockEmitterAccount) // emitterAccount
      .mockResolvedValueOnce(mockReceiverAccount); // receiverAccount
    vi.mocked(blingService.getContactByCnpj).mockResolvedValue(null);
    vi.mocked(blingService.createContactFromCnpj).mockResolvedValue({ id: 42, nome: "Empresa Criada" });

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.sendSaleNFe(saleInput);
    expect(result.success).toBe(true);
    expect(blingService.createContactFromCnpj).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }), // emissora
      mockReceiverAccount.cnpj             // CNPJ da destinatária
    );
  });

  it("usa Magis5 como destinatária quando receiverAccountId = -1", async () => {
    vi.mocked(db.getBlingAccountById)
      .mockResolvedValueOnce(mockAccount)        // sourceAccount
      .mockResolvedValueOnce(mockEmitterAccount); // emitterAccount (Magis5 não chama getBlingAccountById)
    vi.mocked(blingService.getContactByCnpj).mockResolvedValue({ id: 99, nome: "Mega Facility" });

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bling.sendSaleNFe({
      ...saleInput,
      receiverAccountId: -1, // Magis5
    });
    expect(result.success).toBe(true);
    // Deve ter buscado o contato pelo CNPJ do Magis5
    expect(blingService.getContactByCnpj).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }), // emissora
      "57052820000144"                     // CNPJ do Magis5 (Mega Facility SP Ltda)
    );
    // Não deve ter chamado getBlingAccountById para o Magis5 (id=-1)
    // Verifica que a última chamada foi para a conta emissora (id=2), não para -1
    const calls = vi.mocked(db.getBlingAccountById).mock.calls;
    const lastTwoCalls = calls.slice(-2).map((c) => c[0]);
    expect(lastTwoCalls).not.toContain(-1);
  });
});

describe("auth.logout", () => {
  it("limpa o cookie de sessão", async () => {
    const ctx = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(ctx.res.clearCookie).toHaveBeenCalled();
  });
});

describe("tokenRefreshJob", () => {
  it("startTokenRefreshJob retorna um timer e não lança erro", () => {
    vi.mocked(db.getAllBlingAccounts).mockResolvedValue([]);
    expect(() => {
      const timer = startTokenRefreshJob();
      clearInterval(timer);
    }).not.toThrow();
  });

  it("não repete refresh inválido em ciclos consecutivos dentro do backoff", async () => {
    const expiredAccount = {
      ...mockAccount,
      id: 5,
      name: "UniteTech",
      tokenExpiresAt: new Date(Date.now() - 60_000),
    };
    vi.mocked(db.getAllBlingAccounts).mockResolvedValue([expiredAccount]);
    vi.mocked(blingService.refreshBlingToken).mockRejectedValue(
      new Error("Não foi possível renovar o token da conta UniteTech: Invalid refresh token")
    );
    resetInvalidRefreshBackoffForTests();

    const first = await refreshExpiringTokens();
    const second = await refreshExpiringTokens();

    expect(first).toEqual({ renewed: 0, skipped: 0, failed: 1 });
    expect(second).toEqual({ renewed: 0, skipped: 1, failed: 0 });
  });
});
