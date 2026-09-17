import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría 2026-09-17 — la memoria persistente de "este contacto pidió mover
 * su cita" (`booking_change_request`). Lo que importa fijar aquí:
 *  - Registrar el MISMO pedido dos veces es idempotente: no duplica filas, el
 *    índice único parcial por (org, contacto) lo impide y el módulo lo
 *    traduce en "aquí está la que ya existía", nunca en un error.
 *  - Resolver marca la fila como atendida — y solo eso la saca del camino de
 *    `getPendingRescheduleRequest`.
 */

const rows: Record<string, unknown>[] = [];
let nextId = 0;

function chain(fn: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) c[m] = () => c;
  c.limit = () => Promise.resolve(fn());
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(() => rows.filter((r) => r.status === "pending")),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          const clash = rows.some(
            (r) =>
              r.organizationId === v.organizationId &&
              r.contactId === v.contactId &&
              r.status === "pending"
          );
          if (clash) {
            return Promise.reject(
              Object.assign(new Error("duplicate"), { code: "23505" })
            );
          }
          // La columna real trae DEFAULT 'pending' en Postgres; el módulo no
          // lo manda explícito, así que el mock lo simula aquí.
          const row = { status: "pending", ...v };
          rows.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          for (const r of rows) {
            if (r.status === "pending") Object.assign(r, v);
          }
          return { returning: () => Promise.resolve(rows) };
        },
      }),
    }),
  }),
  schema: {
    bookingChangeRequest: {
      organizationId: "organizationId",
      contactId: "contactId",
      status: "status",
    },
  },
}));

vi.mock("@/lib/db/ids", () => ({
  newId: () => `bcr_${++nextId}`,
}));

describe("solicitud de reprogramación: estado persistente e idempotente", () => {
  beforeEach(() => {
    rows.length = 0;
    nextId = 0;
  });

  it("registrar la MISMA solicitud dos veces no crea una segunda fila", async () => {
    const { requestReschedule } = await import(
      "@/server/agenda/reschedule-requests"
    );

    const first = await requestReschedule({
      organizationId: "org_1",
      contactId: "ct_1",
      conversationId: "cv_1",
      note: "mover jueves 10am a viernes",
    });
    expect(first.created).toBe(true);

    const second = await requestReschedule({
      organizationId: "org_1",
      contactId: "ct_1",
      conversationId: "cv_2", // otra conversación, mismo contacto
      note: "insiste en mover la cita",
    });
    expect(second.created).toBe(false);
    expect(second.request).toBe(first.request);

    expect(rows).toHaveLength(1);
  });

  it("getPendingRescheduleRequest encuentra la fila pendiente del contacto", async () => {
    const { requestReschedule, getPendingRescheduleRequest } = await import(
      "@/server/agenda/reschedule-requests"
    );
    await requestReschedule({ organizationId: "org_1", contactId: "ct_1" });

    const found = await getPendingRescheduleRequest("org_1", "ct_1");
    expect(found).toBeTruthy();
    expect(found?.status).toBe("pending");
  });

  it("resolver marca la fila como resuelta: deja de estar pendiente", async () => {
    const {
      requestReschedule,
      getPendingRescheduleRequest,
      resolvePendingRescheduleRequests,
    } = await import("@/server/agenda/reschedule-requests");
    await requestReschedule({ organizationId: "org_1", contactId: "ct_1" });

    await resolvePendingRescheduleRequests("org_1", "ct_1");

    const found = await getPendingRescheduleRequest("org_1", "ct_1");
    expect(found).toBeNull();
    expect(rows[0]?.status).toBe("resolved");
  });

  it("un cambio de tema o un handoff no borra el pedido: sigue pendiente hasta resolverse", async () => {
    const { requestReschedule, getPendingRescheduleRequest } = await import(
      "@/server/agenda/reschedule-requests"
    );
    await requestReschedule({
      organizationId: "org_1",
      contactId: "ct_1",
      conversationId: "cv_1",
      note: "mover jueves a viernes",
    });

    // Simula que la conversación siguió de tema y el turno se volvió a correr
    // sin que nadie tocara la solicitud.
    const stillPending = await getPendingRescheduleRequest("org_1", "ct_1");
    expect(stillPending?.status).toBe("pending");
  });
});
