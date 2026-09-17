import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 6 (auditoría 2026-09) — "probar un cambio antes de publicarlo" (el
 * Laboratorio corriendo con `profileOverride`, ver server/lab/runner.ts) NO
 * debe poder filtrarse a una conversación real bajo ninguna circunstancia:
 * un cliente real jamás debe recibir instrucciones que el operador todavía
 * no publicó. `runAgentTurn` es el único lugar que decide esto — se prueba
 * aquí directamente, no solo a través del Laboratorio, porque es la garantía
 * de seguridad que sostiene toda la función de vista previa.
 */

const chatJsonCalls: unknown[][] = [];
const chatJson = vi.fn(async (...args: unknown[]) => {
  chatJsonCalls.push(args);
  return { ok: true, data: { action: "reply", text: "ok" }, raw: "{}" };
});
vi.mock("@/lib/ai", () => ({ chatJson }));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest: vi.fn() };
});

// El reply real intenta enviarse por WhatsApp; lo que importa aquí es el
// PROMPT que arma runAgentTurn, no el envío — se mockea para no depender de
// más filas de BD que las que ya se cargan (conversación/perfil/mensajes).
class FakeSendError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
vi.mock("@/server/inbox/send", () => ({
  sendText: vi.fn(async () => ({ messageId: "msg_out_1" })),
  SendError: FakeSendError,
}));

const selectQueue: unknown[][] = [];
const inserts: { table: unknown; values: unknown }[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([values]),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{}]),
          then: (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve),
        }),
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }),
    }
  ),
}));

const REAL_PROFILE = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Max",
  tone: null,
  instructions: "Comportamiento REAL publicado",
  escalationRules: null,
  greeting: null,
};

const OVERRIDE = { instructions: "Comportamiento DE PRUEBA sin publicar" };

function inboundMessage() {
  return {
    id: "msg_1",
    direction: "in",
    type: "text",
    text: "hola",
    mediaAssetId: null,
    createdAt: new Date(),
  };
}

function conversation(isTest: boolean) {
  return {
    id: "cv_1",
    organizationId: "org_1",
    contactId: "ct_1",
    isTest,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: new Date(),
  };
}

function lastSystemPrompt(): string {
  const messages = chatJsonCalls.at(-1)?.[1] as
    | { role: string; content: string }[]
    | undefined;
  return messages?.find((m) => m.role === "system")?.content ?? "";
}

describe("runAgentTurn — profileOverride (Fase 6, vista previa del Laboratorio)", () => {
  beforeEach(() => {
    chatJson.mockClear();
    chatJsonCalls.length = 0;
    selectQueue.length = 0;
    inserts.length = 0;
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  });

  it("conversación DE PRUEBA (isTest) → el prompt usa el override, no lo publicado", async () => {
    selectQueue.push(
      [conversation(true)],
      [REAL_PROFILE],
      [inboundMessage()],
      [], // kb
      [] // stages
    );
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1", { profileOverride: OVERRIDE });

    const prompt = lastSystemPrompt();
    expect(prompt).toContain("Comportamiento DE PRUEBA sin publicar");
    expect(prompt).not.toContain("Comportamiento REAL publicado");
  });

  it("conversación REAL (no isTest) → el override se IGNORA aunque se pase por error", async () => {
    selectQueue.push(
      [conversation(false)],
      [REAL_PROFILE],
      [inboundMessage()],
      [], // kb
      [] // stages
    );
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1", { profileOverride: OVERRIDE });

    const prompt = lastSystemPrompt();
    expect(prompt).toContain("Comportamiento REAL publicado");
    expect(prompt).not.toContain("Comportamiento DE PRUEBA sin publicar");
  });
});
