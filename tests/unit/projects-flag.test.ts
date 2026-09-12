import { describe, expect, it } from "vitest";
import { parseProjectsFlag } from "@/server/projects/flag";

/**
 * 021 — La bandera de Proyectos e hitos. El caso que importa es el
 * DEFAULT: una instancia que no la pidió no debe acabar con el módulo
 * encendido por un despiste de configuración, y aceptar una cotización no
 * debe crearle un proyecto que nadie pidió.
 */

describe("parseProjectsFlag", () => {
  it("sin variable, el módulo no existe", () => {
    expect(parseProjectsFlag(undefined)).toBe(false);
    expect(parseProjectsFlag("")).toBe(false);
    expect(parseProjectsFlag("   ")).toBe(false);
  });

  it("`on` lo enciende, con espacios y mayúsculas de por medio", () => {
    expect(parseProjectsFlag("on")).toBe(true);
    expect(parseProjectsFlag("ON")).toBe(true);
    expect(parseProjectsFlag("  On  ")).toBe(true);
  });

  it("acepta las otras formas de decir que sí", () => {
    expect(parseProjectsFlag("1")).toBe(true);
    expect(parseProjectsFlag("true")).toBe(true);
    expect(parseProjectsFlag("si")).toBe(true);
    expect(parseProjectsFlag("sí")).toBe(true);
    expect(parseProjectsFlag("yes")).toBe(true);
  });

  it("cualquier otra cosa lo deja apagado, incluido `off` y `false`", () => {
    expect(parseProjectsFlag("off")).toBe(false);
    expect(parseProjectsFlag("false")).toBe(false);
    expect(parseProjectsFlag("0")).toBe(false);
    expect(parseProjectsFlag("no")).toBe(false);
  });
});
