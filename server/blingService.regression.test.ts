import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlingAccount } from "../drizzle/schema";

vi.mock("./db", () => ({
  getBlingAccountById: vi.fn(),
  getNcmFromCache: vi.fn(),
  getNcmFromCacheBySku: vi.fn(),
  updateBlingToken: vi.fn(),
  upsertNcmCache: vi.fn(),
}));

vi.mock("axios", () => {
  const request = vi.fn();
  const post = vi.fn();
  return { default: Object.assign(request, { post }) };
});

import axios from "axios";
import * as db from "./db";
import { getOrdersByDate, getValidToken, refreshBlingToken } from "./blingService";

function account(overrides: Partial<BlingAccount> = {}): BlingAccount {
  return {
    id: 2,
    userId: 1,
    name: "Bling 2",
    cnpj: null,
    clientId: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-antigo",
    refreshToken: "refresh-antigo",
    tokenExpiresAt: new Date(Date.now() - 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const axiosRequest = vi.mocked(axios);
const axiosPost = vi.mocked(axios.post);

describe("BlingService - regressões das contas 2 e 3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.updateBlingToken).mockResolvedValue(undefined);
  });

  it("recarrega do banco um token já renovado por outro job sem consumir novamente o refresh token", async () => {
    const staleAccount = account();
    const latestAccount = account({
      accessToken: "access-atual",
      refreshToken: "refresh-atual",
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
    vi.mocked(db.getBlingAccountById).mockResolvedValue(latestAccount);

    const token = await getValidToken(staleAccount);

    expect(token).toBe("access-atual");
    expect(staleAccount.accessToken).toBe("access-atual");
    expect(staleAccount.refreshToken).toBe("refresh-atual");
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it("executa uma única renovação quando duas operações concorrentes pedem token da mesma conta", async () => {
    const staleAccount = account();
    vi.mocked(db.getBlingAccountById).mockResolvedValue(staleAccount);
    axiosPost.mockResolvedValue({
      data: {
        access_token: "access-novo",
        refresh_token: "refresh-novo",
        expires_in: 21_600,
      },
    });

    const [first, second] = await Promise.all([
      refreshBlingToken(staleAccount),
      refreshBlingToken(staleAccount),
    ]);

    expect(first).toBe("access-novo");
    expect(second).toBe("access-novo");
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(db.updateBlingToken).toHaveBeenCalledTimes(1);
    expect(staleAccount.refreshToken).toBe("refresh-novo");
  });

  it("renova uma vez e repete a listagem quando a API responde 401", async () => {
    const currentAccount = account({
      accessToken: "access-revogado",
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
    vi.mocked(db.getBlingAccountById).mockResolvedValue(currentAccount);
    axiosPost.mockResolvedValue({
      data: {
        access_token: "access-recuperado",
        refresh_token: "refresh-recuperado",
        expires_in: 21_600,
      },
    });
    axiosRequest
      .mockRejectedValueOnce({
        response: { status: 401, data: { error: { description: "Token inválido" } } },
        message: "Request failed with status code 401",
      })
      .mockResolvedValueOnce({ data: { data: [] } });

    const orders = await getOrdersByDate(currentAccount, "2026-07-28");

    expect(orders).toEqual([]);
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosRequest).toHaveBeenCalledTimes(2);
    expect(axiosRequest.mock.calls[1][0]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer access-recuperado" })
    );
  });

  it("aguarda e repete uma resposta 429 sem bloquear a fila de requisições", async () => {
    const currentAccount = account({
      accessToken: "access-valido",
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    axiosRequest
      .mockRejectedValueOnce({
        response: { status: 429, headers: {}, data: { error: { description: "Too Many Requests" } } },
        message: "Request failed with status code 429",
      })
      .mockResolvedValueOnce({ data: { data: [] } });

    try {
      const orders = await getOrdersByDate(currentAccount, "2026-07-28");
      expect(orders).toEqual([]);
      expect(axiosRequest).toHaveBeenCalledTimes(2);
    } finally {
      randomSpy.mockRestore();
    }
  }, 10_000);
});
