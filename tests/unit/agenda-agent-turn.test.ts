import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría 2026-09-17 — el CONTRATO observable de `agenda/agent.ts`: el
 * texto y el `status` que le llegan a `pipeline.ts` (y de ahí, al prospecto)
 * distinguen sin ambigüedad reserva creada, cita existente, cambio pendiente,
 * horario ocupado y error. Ninguno de estos casos puede leerse como "listo,
 * quedó agendado" ni como "ya te atendió una persona".
 */

const createSessionBooking = vi.fn();
const findActiveBooking = vi.fn();
const requestReschedule = vi.fn();

vi.mock("@/server/agenda/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/service")>();
  return { ...original, createSessionBooking, findActiveBooking };
});
vi.mock("@/server/agenda/reschedule-requests", () => ({ requestReschedule }));
vi.mock("@/lib/env", () => ({ appBaseUrl: () => "https://crm.ejemplo.test" }));

describe("agenda/agent.ts: el texto nunca disfraza el desenlace real", () => {
  beforeEach(() => {
    createSessionBooking.mockReset();
    findActiveBooking.mockReset();
    requestReschedule.mockReset();
  });

  it("reserva creada: status booked y el texto SÍ confirma", async () => {
    const { bookSlot } = await import("@/server/agenda/agent");
    createSessionBooking.mockResolvedValue({
      booking: { id: "bk_1" },
      meetingLink: "https://meet.ejemplo.test/sala",
      linkPending: false,
      label: "mié 5 ago, 09:00",
    });

    const turn = await bookSlot({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: "2026-08-05T15:00:00.000Z",
    });

    expect(turn.ok).toBe(true);
    expect(turn.status).toBe("booked");
    expect(turn.text).toMatch(/listo/i);
  });

  it("cita existente: status existing_booking, NUNCA confirma una nueva", async () => {
    const { bookSlot } = await import("@/server/agenda/agent");
    const { BookingError } = await import("@/server/agenda/service");
    createSessionBooking.mockRejectedValue(
      new BookingError("existing_booking", "ya tiene cita", [], {
        bookingId: "bk_activa",
        label: "jue 17 sep, 10:00",
      })
    );

    const turn = await bookSlot({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: "2026-09-19T15:00:00.000Z",
    });

    expect(turn.ok).toBe(false);
    expect(turn.status).toBe("existing_booking");
    expect(turn.text).toContain("jue 17 sep, 10:00");
    expect(turn.text).not.toMatch(/¡listo!/i);
  });

  it("cambio pendiente: status reschedule_pending, no agenda nada", async () => {
    const { bookSlot } = await import("@/server/agenda/agent");
    const { BookingError } = await import("@/server/agenda/service");
    createSessionBooking.mockRejectedValue(
      new BookingError("reschedule_pending", "cambio pendiente")
    );

    const turn = await bookSlot({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: "2026-09-19T15:00:00.000Z",
    });

    expect(turn.ok).toBe(false);
    expect(turn.status).toBe("reschedule_pending");
    expect(turn.text).not.toMatch(/¡listo!/i);
  });

  it("horario ocupado: status slot_taken, distinto de not_offered", async () => {
    const { bookSlot } = await import("@/server/agenda/agent");
    const { BookingError } = await import("@/server/agenda/service");
    createSessionBooking.mockRejectedValue(
      new BookingError("slot_taken", "se ocupó", [
        { startUtc: "2026-09-19T16:00:00.000Z", label: "sáb 19 sep, 10:00" },
      ])
    );

    const turn = await bookSlot({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: "2026-09-19T15:00:00.000Z",
    });

    expect(turn.status).toBe("slot_taken");
  });

  it("error del motor sin alternativas: status error, no ok", async () => {
    const { bookSlot } = await import("@/server/agenda/agent");
    const { BookingError } = await import("@/server/agenda/service");
    createSessionBooking.mockRejectedValue(new BookingError("not_found", "no existe"));

    const turn = await bookSlot({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: "2026-09-19T15:00:00.000Z",
    });

    expect(turn.ok).toBe(false);
    expect(turn.status).toBe("error");
  });

  it("una reunión aparte confirmada explícitamente pasa allowAdditional al servicio", async () => {
    const { bookSlot } = await import("@/server/agenda/agent");
    createSessionBooking.mockResolvedValue({
      booking: { id: "bk_2" },
      meetingLink: null,
      linkPending: false,
      label: "vie 18 sep, 11:00",
    });

    await bookSlot({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: "2026-09-18T17:00:00.000Z",
      reason: "reunión aparte para otro producto",
      confirmAdditional: true,
    });

    expect(createSessionBooking).toHaveBeenCalledWith(
      expect.objectContaining({ allowAdditional: true })
    );
  });

  it("registrar el cambio deriva a texto de espera, nunca de confirmación", async () => {
    const { recordRescheduleRequest } = await import("@/server/agenda/agent");
    findActiveBooking.mockResolvedValue({ id: "bk_activa" });
    requestReschedule.mockResolvedValue({ created: true, request: {} });

    const turn = await recordRescheduleRequest({
      organizationId: "org_1",
      conversationId: "cv_1",
      contactId: "ct_1",
      note: "mover jueves a viernes",
    });

    expect(turn.status).toBe("reschedule_pending");
    expect(turn.text).not.toMatch(/¡listo!/i);
    expect(requestReschedule).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "ct_1", originalBookingId: "bk_activa" })
    );
  });

  it("si la persistencia del cambio falla, igual devuelve el texto de espera (nunca se cae el turno)", async () => {
    const { recordRescheduleRequest } = await import("@/server/agenda/agent");
    findActiveBooking.mockRejectedValue(new Error("db caída"));

    const turn = await recordRescheduleRequest({
      organizationId: "org_1",
      conversationId: "cv_1",
      contactId: "ct_1",
    });

    expect(turn.status).toBe("reschedule_pending");
    expect(turn.ok).toBe(true);
  });
});
