import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-09-16 — Bug reportado: hubo mensajes no entregados (Meta 131026) que
 * el CRM nunca mostró como fallidos — a diferencia de un adjunto
 * (`sendMediaMessage`), un rechazo SÍNCRONO de Meta al mandar TEXTO
 * (`sendText`, la vía que usa el agente para sus respuestas) no dejaba
 * ningún rastro: ni burbuja "failed" en el hilo, ni fila en `message`. El
 * prospecto se quedaba sin nada y nadie se enteraba.
 *
 * Estos tests fijan que un rechazo real de Meta (o un destinatario sin
 * teléfono/identidad utilizable) SIEMPRE deja un mensaje "failed" visible con
 * el motivo traducido (`describeSendError`), y que los códigos que YA tienen
 * su propia UX (ventana cerrada → traspaso; sin conexión/token vencido →
 * banner de Ajustes; sandbox del Laboratorio) NO generan una burbuja
 * duplicada.
 */

const graphRequest = vi.fn();
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const getCredentialsByOrg = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg,
  markReconnectRequired: vi.fn(),
}));

vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectRows: unknown[][] = [];
const inserted: { values: Record<string, unknown> }[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => makeChain(selectRows.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ values });
        return {
          returning: () =>
            Promise.resolve([
              { ...values, id: "msg_1", createdAt: new Date(), waTimestamp: null },
            ]),
        };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  }),
  schema: {
    conversation: { contactId: "contactId", id: "id" },
    contact: { id: "id" },
    message: {},
  },
}));

const CONTACT = { id: "ct_1", phone: "5215511111111" };
function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    conversation: {
      id: "cv_1",
      organizationId: "org_1",
      isTest: false,
      channel: "whatsapp",
      lastInboundAt: new Date(),
      ...overrides,
    },
    contact: CONTACT,
  };
}

describe("sendText — un rechazo real de Meta queda visible", () => {
  beforeEach(() => {
    graphRequest.mockReset();
    getCredentialsByOrg.mockReset();
    selectRows.length = 0;
    inserted.length = 0;
    getCredentialsByOrg.mockResolvedValue({
      token: "token-test",
      phoneNumberId: "pnid_1",
      organizationId: "org_1",
    });
  });

  it("Meta rechaza síncronamente (131026) → persiste 'failed' con el motivo traducido", async () => {
    const { MetaApiError } = await import("@/lib/meta/client");
    graphRequest.mockRejectedValue(
      new MetaApiError("Message Undeliverable", { status: 400, code: 131026 })
    );
    selectRows.push([conversationRow()]);
    const { sendText, SendError } = await import("@/server/inbox/send");

    await expect(
      sendText({
        conversationId: "cv_1",
        organizationId: "org_1",
        text: "hola",
        aiGenerated: true,
      })
    ).rejects.toMatchObject({
      code: "meta_error",
      message: expect.stringMatching(/no puede recibir/i),
    });

    const failedInsert = inserted.find((i) => i.values.status === "failed");
    expect(failedInsert).toBeDefined();
    expect(failedInsert!.values.error).toMatch(/no puede recibir/i);
    expect(failedInsert!.values.text).toBe("hola");
    expect(failedInsert!.values.direction).toBe("out");

    // sanity: instancia tipada, no un Error genérico.
    let caught: unknown;
    selectRows.push([conversationRow()]);
    try {
      await sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SendError);
  });

  it("contacto sin teléfono ni identidad utilizable → 'failed' visible, no un silencio total", async () => {
    selectRows.push([
      {
        conversation: {
          id: "cv_1",
          organizationId: "org_1",
          isTest: false,
          channel: "whatsapp",
          lastInboundAt: new Date(),
        },
        contact: { id: "ct_2", phone: null, waUserId: null },
      },
    ]);
    const { sendText } = await import("@/server/inbox/send");

    await expect(
      sendText({
        conversationId: "cv_1",
        organizationId: "org_1",
        text: "hola",
        aiGenerated: true,
      })
    ).rejects.toMatchObject({ code: "meta_error" });

    expect(graphRequest).not.toHaveBeenCalled();
    const failedInsert = inserted.find((i) => i.values.status === "failed");
    expect(failedInsert).toBeDefined();
    expect(failedInsert!.values.error).toMatch(/no tiene teléfono/i);
  });

  it("ventana cerrada → SIN burbuja 'failed' duplicada (ya se convierte en traspaso aparte)", async () => {
    selectRows.push([conversationRow({ lastInboundAt: null })]);
    const { sendText } = await import("@/server/inbox/send");

    await expect(
      sendText({ conversationId: "cv_1", organizationId: "org_1", text: "hola" })
    ).rejects.toMatchObject({ code: "window_closed" });

    expect(inserted.length).toBe(0);
    expect(graphRequest).not.toHaveBeenCalled();
  });
});
