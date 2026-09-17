import { describe, expect, it } from "vitest";
import { agentActionSchema, degradeAction } from "@/server/ai/actions";

/**
 * Auditoría 2026-09-17 — el contrato de `request_reschedule` y de
 * `book_slot.confirmAdditional`: solo existen cuando la agenda está
 * encendida, y una acción de agenda que no se pudo ejecutar degrada a texto
 * en vez de desaparecer en silencio.
 */

describe("request_reschedule solo existe con la agenda encendida", () => {
  it("con agenda apagada, el esquema RECHAZA request_reschedule", () => {
    const schema = agentActionSchema(false);
    const result = schema.safeParse({ action: "request_reschedule", note: "mover cita" });
    expect(result.success).toBe(false);
  });

  it("con agenda encendida, acepta request_reschedule con note opcional", () => {
    const schema = agentActionSchema(true);
    const result = schema.safeParse({
      action: "request_reschedule",
      note: "mover jueves a viernes",
      reply: "listo, lo confirmo con el equipo",
    });
    expect(result.success).toBe(true);
  });

  it("book_slot acepta confirmAdditional como booleano opcional", () => {
    const schema = agentActionSchema(true);
    const result = schema.safeParse({
      action: "book_slot",
      startUtc: "2026-09-19T15:00:00.000Z",
      confirmAdditional: true,
      reason: "reunión aparte por otro producto",
    });
    expect(result.success).toBe(true);
  });
});

describe("degradeAction: una acción de agenda que no se pudo ejecutar no desaparece", () => {
  it("request_reschedule con reply se degrada a reply", () => {
    const degraded = degradeAction({
      action: "request_reschedule",
      reply: "dame un momento",
    });
    expect(degraded).toEqual({ action: "reply", text: "dame un momento" });
  });

  it("request_reschedule sin reply se degrada a none, nunca a un booking", () => {
    const degraded = degradeAction({ action: "request_reschedule" });
    expect(degraded).toEqual({ action: "none" });
  });
});
