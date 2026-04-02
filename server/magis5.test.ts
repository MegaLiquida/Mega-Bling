import { describe, it, expect } from "vitest";
import axios from "axios";

const MAGIS5_API = "https://app.magis5.com.br/v1";
const API_KEY = process.env.MAGIS5_API_KEY ?? "";

describe("Magis5 API", () => {
  it("deve autenticar com o token e buscar pedidos faturados", async () => {
    expect(API_KEY).toBeTruthy();

    const response = await axios.get(`${MAGIS5_API}/orders`, {
      headers: { "X-MAGIS5-APIKEY": API_KEY },
      params: { status: "billed", limit: 1, structureType: "Complete" },
    });

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty("orders");
    expect(Array.isArray(response.data.orders)).toBe(true);
    console.log(`[Magis5 Test] Token válido. Pedidos retornados: ${response.data.orders.length}`);
  });
});
