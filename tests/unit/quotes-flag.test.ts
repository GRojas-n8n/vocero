import { describe, expect, it } from "vitest";
import { parseQuotesFlag } from "@/server/quotes/flag";

/**
 * 019 — La bandera de cotizaciones. El caso que importa es el DEFAULT: una
 * instancia que no la pidió no debe acabar con el módulo encendido por un
 * despiste de configuración.
 */

describe("parseQuotesFlag", () => {
  it("sin variable, el módulo no existe", () => {
    expect(parseQuotesFlag(undefined)).toBe(false);
    expect(parseQuotesFlag("")).toBe(false);
    expect(parseQuotesFlag("   ")).toBe(false);
  });

  it("`on` lo enciende, con espacios y mayúsculas de por medio", () => {
    expect(parseQuotesFlag("on")).toBe(true);
    expect(parseQuotesFlag("ON")).toBe(true);
    expect(parseQuotesFlag("  On  ")).toBe(true);
  });

  it("acepta las otras formas de decir que sí", () => {
    expect(parseQuotesFlag("1")).toBe(true);
    expect(parseQuotesFlag("true")).toBe(true);
    expect(parseQuotesFlag("si")).toBe(true);
    expect(parseQuotesFlag("sí")).toBe(true);
    expect(parseQuotesFlag("yes")).toBe(true);
  });

  it("cualquier otra cosa lo deja apagado, incluido `off` y `false`", () => {
    expect(parseQuotesFlag("off")).toBe(false);
    expect(parseQuotesFlag("false")).toBe(false);
    expect(parseQuotesFlag("0")).toBe(false);
    expect(parseQuotesFlag("no")).toBe(false);
    expect(parseQuotesFlag("onn")).toBe(false);
  });
});
