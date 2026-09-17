import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría 2026-09-17 — el blindaje contra una SEGUNDA cita activa para el
 * mismo contacto (el bug reportado: Max agendó jueves 09:00 y, tras derivar
 * un pedido de moverla, agendó TAMBIÉN jueves 10:00 para el mismo prospecto).
 *
 * Fija en un test lo que `createSessionBooking` debe garantizar:
 *  - Con una cita activa ya puesta, una segunda se bloquea (`existing_booking`)
 *    a menos que se confirme EXPLÍCITAMENTE como reunión aparte.
 *  - Con un cambio de horario pendiente (`booking_change_request`), se
 *    bloquea igual (`reschedule_pending`), sin importar el instante pedido.
 *  - `allowAdditional` sin una nota que explique por qué es aparte se
 *    rechaza: la confirmación explícita exige constancia escrita.
 *  - La carrera exacta (23505 en el índice por contacto) se traduce al mismo
 *    código que el pre-chequeo, y la cita jamás se crea.
 */

const settings = {
  weeklyHours: { wed: [{ start: "09:00", end: "18:00" }] },
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxDaysAhead: 7,
  timezone: "America/Mexico_City",
  connector: "enlace-fijo" as const,
  meetingLink: "https://meet.ejemplo.com/sala",
};

const SLOT = "2026-08-05T15:00:00.000Z";

const replaceOffers = vi.fn(async () => {});
const clearOffers = vi.fn(async () => {});
const moveLeadToStage = vi.fn(async () => ({ ok: true as const }));
const createMeeting = vi.fn(async () => ({
  externalId: null,
  joinUrl: settings.meetingLink,
}));

vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => settings }));
vi.mock("@/server/agenda/availability", () => ({
  findSlot: async () => ({ startUtc: SLOT, endUtc: "…", label: "mié 5 ago, 09:00" }),
  computeAvailability: async () => [],
}));
vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/offers")>();
  return {
    ...original,
    getOffers: async () => [{ startUtc: SLOT, label: "mié 5 ago, 09:00" }],
    replaceOffers,
    clearOffers,
  };
});
vi.mock("@/server/agenda/connectors", () => ({
  bindConnector: async () => ({
    id: "enlace-fijo",
    createMeeting,
    updateMeeting: async () => {},
    deleteMeeting: async () => {},
    testConnection: async () => ({ ok: true }),
  }),
  markConnectorAuthError: async () => {},
}));
vi.mock("@/server/leads/stage-history", () => ({ moveLeadToStage }));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));

const selectRows: unknown[][] = [];
let insertThrows: unknown = null;
const inserted: Record<string, unknown>[] = [];
let lastInsertedRow: Record<string, unknown> = {};

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin", "innerJoin"]) {
    c[m] = () => c;
  }
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectRows.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          if (insertThrows) return Promise.reject(insertThrows);
          inserted.push(v);
          lastInsertedRow = {
            ...v,
            scheduledAt: new Date(SLOT),
            meetingLink: null,
            linkPending: false,
            externalRef: null,
          };
          return Promise.resolve([lastInsertedRow]);
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () =>
            Promise.resolve([{ ...lastInsertedRow, ...v }]),
        }),
      }),
    }),
  }),
  schema: {
    booking: {},
    conversation: { organizationId: "organizationId", id: "id" },
    contact: { organizationId: "organizationId", id: "id", name: "name" },
    lead: { organizationId: "organizationId", contactId: "contactId" },
    pipelineStage: { organizationId: "organizationId" },
    offeredSlot: {},
    bookingChangeRequest: {
      organizationId: "organizationId",
      contactId: "contactId",
      status: "status",
    },
  },
}));

/** 1) conversación, 2) nombre del contacto. */
function primeToContact() {
  selectRows.push([{ contactId: "ct_1", isTest: false }]);
  selectRows.push([{ name: "Ana" }]);
}

describe("blindaje: una segunda cita activa por contacto", () => {
  beforeEach(() => {
    selectRows.length = 0;
    inserted.length = 0;
    insertThrows = null;
    replaceOffers.mockClear();
    createMeeting.mockClear();
  });

  it("con una cita activa ya puesta, book_slot se bloquea con existing_booking", async () => {
    const { createSessionBooking, BookingError } = await import(
      "@/server/agenda/service"
    );
    primeToContact();
    selectRows.push([]); // sin cambio de horario pendiente
    selectRows.push([
      {
        id: "bk_activa",
        organizationId: "org_1",
        contactId: "ct_1",
        scheduledAt: new Date("2026-08-06T16:00:00.000Z"),
        status: "agendada",
        kind: "session",
        isTest: false,
      },
    ]); // la cita activa

    const promise = createSessionBooking({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: SLOT,
      source: "ai",
      requireOffer: true,
    });

    await expect(promise).rejects.toBeInstanceOf(BookingError);
    await promise.catch((err) => {
      expect(err.code).toBe("existing_booking");
      expect(err.existing?.bookingId).toBe("bk_activa");
    });
    expect(inserted).toHaveLength(0);
  });

  it("con un cambio de horario pendiente, se bloquea con reschedule_pending", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    primeToContact();
    selectRows.push([
      {
        id: "bcr_1",
        organizationId: "org_1",
        contactId: "ct_1",
        originalBookingId: null,
        status: "pending",
      },
    ]); // cambio pendiente, sin cita original identificada

    const promise = createSessionBooking({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: SLOT,
      source: "ai",
      requireOffer: true,
    });

    await expect(promise).rejects.toMatchObject({ code: "reschedule_pending" });
    expect(inserted).toHaveLength(0);
  });

  it("allowAdditional sin notas se rechaza: la confirmación explícita exige constancia", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    primeToContact();

    await expect(
      createSessionBooking({
        organizationId: "org_1",
        conversationId: "cv_1",
        startUtc: SLOT,
        source: "ai",
        requireOffer: true,
        allowAdditional: true,
      })
    ).rejects.toMatchObject({ code: "invalid" });
    expect(inserted).toHaveLength(0);
  });

  it("allowAdditional CON notas crea la cita marcada additionalConfirmed, sin tocar la activa", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    primeToContact();
    selectRows.push([{ id: "ld_1" }]); // el lead — REGLA 3 no consulta nada con allowAdditional

    const result = await createSessionBooking({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: SLOT,
      source: "ai",
      requireOffer: true,
      allowAdditional: true,
      notes: "reunión aparte para logística, el cliente lo pidió explícito",
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.additionalConfirmed).toBe(true);
    expect(result.booking).toBeTruthy();
  });

  it("la carrera por CONTACTO (23505 en el índice nuevo) se traduce a existing_booking", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    primeToContact();
    selectRows.push([]); // sin cambio pendiente
    selectRows.push([]); // sin cita activa (el pre-chequeo no la vio a tiempo)
    selectRows.push([{ id: "ld_1" }]); // el lead
    insertThrows = { code: "23505", constraint: "booking_org_contact_single_active_uq" };
    // Tras el 23505, el catch vuelve a buscar la cita activa para nombrarla.
    selectRows.push([
      {
        id: "bk_ganadora",
        organizationId: "org_1",
        contactId: "ct_1",
        scheduledAt: new Date("2026-08-06T16:00:00.000Z"),
        status: "agendada",
        kind: "session",
        isTest: false,
      },
    ]);

    const promise = createSessionBooking({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: SLOT,
      source: "ai",
      requireOffer: true,
    });

    await expect(promise).rejects.toMatchObject({ code: "existing_booking" });
    await promise.catch((err) => {
      expect(err.existing?.bookingId).toBe("bk_ganadora");
    });
    expect(inserted).toHaveLength(0);
  });
});
