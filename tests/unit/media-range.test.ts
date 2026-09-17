import { describe, expect, it } from "vitest";
import { parseRangeHeader } from "@/lib/http/range";

/**
 * 2026-09-16 — El reproductor de audio del CRM mostraba 0:00 con una nota de
 * voz sana: `/api/media/[assetId]` nunca soportó `Range`, así que el
 * navegador no podía calcular la duración ni buscar dentro del archivo. Este
 * módulo es la lógica pura que arregla eso.
 */
describe("parseRangeHeader", () => {
  it("sin header → null (se sirve completo)", () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
  });

  it("rango simple bytes=0-99", () => {
    expect(parseRangeHeader("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
  });

  it("rango abierto bytes=500- → hasta el final", () => {
    expect(parseRangeHeader("bytes=500-", 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });

  it("sufijo bytes=-200 → últimos 200 bytes", () => {
    expect(parseRangeHeader("bytes=-200", 1000)).toEqual({
      start: 800,
      end: 999,
    });
  });

  it("sufijo mayor que el archivo → se recorta a 0", () => {
    expect(parseRangeHeader("bytes=-5000", 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it("end más allá del archivo → se recorta al último byte", () => {
    expect(parseRangeHeader("bytes=0-9999", 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it("start > end → inválido, null", () => {
    expect(parseRangeHeader("bytes=900-100", 1000)).toBeNull();
  });

  it("multi-rango (bytes=0-99,200-299) → usa solo el primero", () => {
    expect(parseRangeHeader("bytes=0-99,200-299", 1000)).toEqual({
      start: 0,
      end: 99,
    });
  });

  it("unidad no soportada (items=0-99) → null", () => {
    expect(parseRangeHeader("items=0-99", 1000)).toBeNull();
  });

  it("archivo vacío → null", () => {
    expect(parseRangeHeader("bytes=0-99", 0)).toBeNull();
  });

  it("basura → null", () => {
    expect(parseRangeHeader("bytes=abc-xyz", 1000)).toBeNull();
  });
});
