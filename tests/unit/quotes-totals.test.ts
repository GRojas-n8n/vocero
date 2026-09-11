import { describe, expect, it } from "vitest";
import { assertValidItems, computeTotals, QuoteError } from "@/server/quotes/service";
import { toDisplayStatus } from "@/server/quotes/queries";

/**
 * 019 — Aritmética de totales y validación de renglones. Todo en CENTAVOS
 * ENTEROS, igual que el resto del dinero en este CRM (`src/lib/money.ts`).
 */

describe("computeTotals", () => {
  it("suma cantidad × precio unitario de cada renglón", () => {
    const { itemTotals, subtotalCents } = computeTotals(
      [
        { description: "A", quantity: 2, unitPriceCents: 1000 },
        { description: "B", quantity: 1, unitPriceCents: 500 },
      ],
      0
    );
    expect(itemTotals).toEqual([2000, 500]);
    expect(subtotalCents).toBe(2500);
  });

  it("resta el descuento del subtotal", () => {
    const { totalCents } = computeTotals(
      [{ description: "A", quantity: 1, unitPriceCents: 1000 }],
      300
    );
    expect(totalCents).toBe(700);
  });

  it("un descuento mayor al subtotal no deja el total en negativo", () => {
    const { totalCents } = computeTotals(
      [{ description: "A", quantity: 1, unitPriceCents: 1000 }],
      5000
    );
    expect(totalCents).toBe(0);
  });
});

describe("assertValidItems", () => {
  it("rechaza una cotización sin renglones", () => {
    expect(() => assertValidItems([])).toThrow(QuoteError);
  });

  it("rechaza un renglón sin descripción", () => {
    expect(() =>
      assertValidItems([{ description: "  ", quantity: 1, unitPriceCents: 100 }])
    ).toThrow(QuoteError);
  });

  it("rechaza cantidad no entera o menor a 1", () => {
    expect(() =>
      assertValidItems([{ description: "A", quantity: 0, unitPriceCents: 100 }])
    ).toThrow(QuoteError);
    expect(() =>
      assertValidItems([{ description: "A", quantity: 1.5, unitPriceCents: 100 }])
    ).toThrow(QuoteError);
  });

  it("rechaza precio unitario negativo", () => {
    expect(() =>
      assertValidItems([{ description: "A", quantity: 1, unitPriceCents: -1 }])
    ).toThrow(QuoteError);
  });

  it("acepta un renglón válido, precio en cero incluido (cortesía)", () => {
    expect(() =>
      assertValidItems([{ description: "Regalo", quantity: 1, unitPriceCents: 0 }])
    ).not.toThrow();
  });
});

describe("toDisplayStatus", () => {
  it("una cotización enviada sin vencimiento no vence nunca", () => {
    expect(toDisplayStatus("enviada", null)).toBe("enviada");
  });

  it("enviada con vencimiento futuro sigue siendo enviada", () => {
    const futuro = new Date(Date.now() + 86_400_000);
    expect(toDisplayStatus("enviada", futuro)).toBe("enviada");
  });

  it("enviada con vencimiento pasado se muestra vencida", () => {
    const pasado = new Date(Date.now() - 86_400_000);
    expect(toDisplayStatus("enviada", pasado)).toBe("vencida");
  });

  it("un vencimiento pasado no afecta a borrador, aceptada ni rechazada", () => {
    const pasado = new Date(Date.now() - 86_400_000);
    expect(toDisplayStatus("borrador", pasado)).toBe("borrador");
    expect(toDisplayStatus("aceptada", pasado)).toBe("aceptada");
    expect(toDisplayStatus("rechazada", pasado)).toBe("rechazada");
  });
});
