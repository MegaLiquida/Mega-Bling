import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@shared/cnpj";

describe("CNPJ utilities", () => {
  it("normalizes punctuation and limits the value to 14 digits", () => {
    expect(normalizeCnpj("60.476.631/0001-03 extra 999")).toBe("60476631000103");
  });

  it("formats a complete CNPJ", () => {
    expect(formatCnpj("60476631000103")).toBe("60.476.631/0001-03");
  });

  it("accepts known valid CNPJs", () => {
    expect(isValidCnpj("60.476.631/0001-03")).toBe(true);
    expect(isValidCnpj("57.052.820/0001-44")).toBe(true);
  });

  it("rejects malformed or invalid CNPJs", () => {
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
    expect(isValidCnpj("60.476.631/0001-04")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
  });
});
