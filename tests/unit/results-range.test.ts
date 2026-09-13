import { describe, expect, it } from "vitest";
import { rangeBounds, resolveRange } from "@/server/results/range";

/**
 * Resultados debe resolver "hoy"/"este mes"/rangos en la zona horaria del
 * NEGOCIO, no en UTC — un desfase de unas horas en el borde del día movía
 * cierres reales de un mes al siguiente. Ver `range.ts`.
 */

const MX = "America/Mexico_City"; // UTC-6 todo el año (sin horario de verano desde 2022).

describe("resolveRange — zona horaria del negocio", () => {
  it('"hoy" es el día en la zona del negocio, no el día UTC', () => {
    // 2026-09-13T02:00:00Z ⇒ 2026-09-12 20:00 en Ciudad de México: sigue siendo el 12.
    const now = new Date("2026-09-13T02:00:00.000Z");
    const range = resolveRange("7d", null, null, MX, now);
    expect(range.to).toBe("2026-09-12");
    expect(range.from).toBe("2026-09-06");
  });

  it('"este mes" empieza el día 1 del mes en curso EN LA ZONA del negocio', () => {
    // 2026-10-01T03:00:00Z ⇒ 2026-09-30 21:00 en CDMX: para el negocio aún es septiembre.
    const now = new Date("2026-10-01T03:00:00.000Z");
    const range = resolveRange("this_month", null, null, MX, now);
    expect(range.from).toBe("2026-09-01");
    expect(range.to).toBe("2026-09-30");
  });

  it('"mes pasado" resuelve el mes calendario completo anterior', () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    const range = resolveRange("last_month", null, null, MX, now);
    expect(range.from).toBe("2026-08-01");
    expect(range.to).toBe("2026-08-31");
  });

  it("custom conserva las fechas explícitas y ordena from<=to", () => {
    const range = resolveRange("custom", "2026-09-20", "2026-09-10", MX);
    expect(range.from).toBe("2026-09-10");
    expect(range.to).toBe("2026-09-20");
  });
});

describe("rangeBounds — límites UTC de un día completo en la zona del negocio", () => {
  it("un solo día en CDMX (UTC-6) da [06:00Z, +1d 05:59:59.999Z)", () => {
    const { start, end } = rangeBounds(
      { preset: "custom", from: "2026-09-12", to: "2026-09-12" },
      MX
    );
    expect(start.toISOString()).toBe("2026-09-12T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-13T05:59:59.999Z");
  });

  it("un movimiento a las 23:50 hora CDMX cae DENTRO del rango de ese día", () => {
    const { start, end } = rangeBounds(
      { preset: "custom", from: "2026-09-12", to: "2026-09-12" },
      MX
    );
    const lateLocalMove = new Date("2026-09-13T05:50:00.000Z"); // 23:50 CDMX del 12
    expect(lateLocalMove.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(lateLocalMove.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});
