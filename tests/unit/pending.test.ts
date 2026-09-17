import { describe, expect, it } from "vitest";
import {
  isPendingReply,
  PENDING_REPLY_THRESHOLD_MS,
} from "@/server/inbox/pending";

/**
 * 2026-09-16 — Bug reportado: un mensaje del prospecto quedó sin respuesta
 * aunque "No leídas" marcaba 0. `unreadCount` solo dice si alguien VIO el
 * hilo; "pendiente de responder" es una señal aparte, derivada de si YA
 * salió algo después del último entrante — ver server/inbox/pending.ts.
 */
describe("pendiente de responder (distinto de 'sin leer')", () => {
  const now = new Date("2026-09-16T12:00:00Z");

  it("sin ningún entrante → nunca pendiente", () => {
    expect(isPendingReply(null, null, now)).toBe(false);
  });

  it("entrante reciente, agente sin haber tenido tiempo de responder → NO pendiente todavía", () => {
    const lastInboundAt = new Date(now.getTime() - 5_000); // hace 5s
    expect(isPendingReply(lastInboundAt, lastInboundAt, now)).toBe(false);
  });

  it("entrante viejo sin ninguna salida detrás → pendiente", () => {
    const lastInboundAt = new Date(
      now.getTime() - PENDING_REPLY_THRESHOLD_MS - 1
    );
    // ingest.ts fija lastMessageAt = lastInboundAt en cada entrante.
    expect(isPendingReply(lastInboundAt, lastInboundAt, now)).toBe(true);
  });

  it("ya hubo una salida DESPUÉS del último entrante → no pendiente", () => {
    const lastInboundAt = new Date(
      now.getTime() - PENDING_REPLY_THRESHOLD_MS - 1
    );
    const lastMessageAt = new Date(now.getTime() - 1_000); // el reply salió hace 1s
    expect(isPendingReply(lastInboundAt, lastMessageAt, now)).toBe(false);
  });

  it("el turno del agente falló en silencio (mismo lastMessageAt del entrante) → pendiente tras el umbral", () => {
    // Reproduce exactamente el bug: el entrante actualiza lastInboundAt Y
    // lastMessageAt al mismo instante (ingest.ts); si el turno del agente
    // revienta antes de mandar nada, lastMessageAt nunca vuelve a avanzar.
    const t = new Date(now.getTime() - PENDING_REPLY_THRESHOLD_MS - 60_000);
    expect(isPendingReply(t, t, now)).toBe(true);
  });

  it("borde exacto del umbral → todavía no pendiente (estricto)", () => {
    const lastInboundAt = new Date(now.getTime() - PENDING_REPLY_THRESHOLD_MS);
    expect(isPendingReply(lastInboundAt, lastInboundAt, now)).toBe(false);
  });

  it("el envío rechazado por Meta (131026, etc.) → pendiente DE INMEDIATO, sin esperar el margen", () => {
    // lastMessageAt avanzó (el intento de envío sí se persistió), pero
    // status: "failed" — el prospecto no recibió nada. No hay que esperar
    // PENDING_REPLY_THRESHOLD_MS: ya sabemos que falló, es definitivo.
    const lastInboundAt = new Date(now.getTime() - 5_000);
    const lastMessageAt = new Date(now.getTime() - 1_000);
    expect(isPendingReply(lastInboundAt, lastMessageAt, now, true)).toBe(true);
  });

  it("envío exitoso después del entrante (lastMessageFailed: false) → no pendiente", () => {
    const lastInboundAt = new Date(now.getTime() - 5_000);
    const lastMessageAt = new Date(now.getTime() - 1_000);
    expect(isPendingReply(lastInboundAt, lastMessageAt, now, false)).toBe(false);
  });
});
