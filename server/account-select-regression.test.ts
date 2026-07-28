import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/Home.tsx"),
  "utf8",
);

describe("seletores de conta sem portal", () => {
  it("mantém os quatro seletores de conta como elementos HTML nativos", () => {
    const nativeSelectCount = homeSource.match(/<select\b/g)?.length ?? 0;

    expect(nativeSelectCount).toBeGreaterThanOrEqual(4);
    expect(homeSource).not.toContain("@/components/ui/select");
    expect(homeSource).not.toContain("<SelectContent");
  });

  it.each([
    "Conta de Origem",
    "Conta Bling Emissora",
    "Conta Emissora",
    "Conta Destinatária",
  ])("preserva o seletor acessível %s", (label) => {
    expect(homeSource).toContain(`aria-label="${label}"`);
  });
});
