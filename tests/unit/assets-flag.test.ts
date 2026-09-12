import { describe, expect, it } from "vitest";
import { parseAssetsFlag } from "@/server/assets/flag";

/**
 * 020 — La bandera de Activos de cliente. El caso que importa es el
 * DEFAULT: una instancia que no la pidió no debe acabar con el módulo
 * encendido por un despiste de configuración.
 */

describe("parseAssetsFlag", () => {
  it("sin variable, el módulo no existe", () => {
    expect(parseAssetsFlag(undefined)).toBe(false);
    expect(parseAssetsFlag("")).toBe(false);
    expect(parseAssetsFlag("   ")).toBe(false);
  });

  it("`on` lo enciende, con espacios y mayúsculas de por medio", () => {
    expect(parseAssetsFlag("on")).toBe(true);
    expect(parseAssetsFlag("ON")).toBe(true);
    expect(parseAssetsFlag("  On  ")).toBe(true);
  });

  it("acepta las otras formas de decir que sí", () => {
    expect(parseAssetsFlag("1")).toBe(true);
    expect(parseAssetsFlag("true")).toBe(true);
    expect(parseAssetsFlag("si")).toBe(true);
    expect(parseAssetsFlag("sí")).toBe(true);
    expect(parseAssetsFlag("yes")).toBe(true);
  });

  it("cualquier otra cosa lo deja apagado, incluido `off` y `false`", () => {
    expect(parseAssetsFlag("off")).toBe(false);
    expect(parseAssetsFlag("false")).toBe(false);
    expect(parseAssetsFlag("0")).toBe(false);
    expect(parseAssetsFlag("no")).toBe(false);
  });
});
