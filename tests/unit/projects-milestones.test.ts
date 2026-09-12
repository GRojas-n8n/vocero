import { describe, expect, it } from "vitest";
import { DEFAULT_MILESTONES } from "@/server/projects/service";

/**
 * 021 — Los 4 hitos con los que nace todo proyecto de la agencia son fijos
 * y en este orden: el flujo de entrega no cambia de un cliente a otro.
 */
describe("DEFAULT_MILESTONES", () => {
  it("son exactamente los 4 hitos de la agencia, en orden", () => {
    expect(DEFAULT_MILESTONES).toEqual([
      "Recopilación de accesos y materiales",
      "Desarrollo en entorno de Staging / Coolify",
      "Revisión y ajustes del cliente",
      "Lanzamiento en Producción",
    ]);
  });
});
