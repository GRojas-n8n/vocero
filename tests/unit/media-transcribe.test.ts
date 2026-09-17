import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-09-16 — Antes, una transcripción que el proveedor devolvía como "sin
 * resultado" (`{ ok: false }`, p. ej. el modelo configurado no acepta audio,
 * o "sin voz entendible") se perdía en absoluto silencio:
 * `if (!result.ok) return;` sin loguear nada y sin dejar rastro en BD. El
 * turno del agente no tenía forma de distinguir "todavía transcribiendo" de
 * "ya falló". Estos tests fijan que ahora SIEMPRE queda un motivo legible.
 */

const transcribeAudio = vi.fn();
vi.mock("@/lib/ai", () => ({ transcribeAudio }));

const graphRequest = vi.fn();
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const getCredentialsByOrg = vi.fn();
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg }));

vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
}));

const updates: { set: unknown }[] = [];
const selectQueue: unknown[][] = [];
// Simula RETURNING * de Postgres: cada update se funde sobre la última fila
// leída, así `ensureAssetAvailable` ve de vuelta kind/caption sin tocar.
let mockRow: Record<string, unknown> = {};

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "where"]) chain[m] = () => chain;
      chain.limit = () =>
        Promise.resolve(selectQueue.shift() ?? []).then((rows) => {
          if (Array.isArray(rows) && rows[0]) {
            mockRow = { ...(rows[0] as Record<string, unknown>) };
          }
          return rows;
        });
      return chain;
    },
    update: () => ({
      set: (set: unknown) => {
        updates.push({ set });
        mockRow = { ...mockRow, ...(set as Record<string, unknown>) };
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...mockRow }]),
          }),
        };
      },
    }),
  }),
  schema: {
    mediaAsset: { id: "id", organizationId: "organizationId" },
    message: { mediaAssetId: "mediaAssetId" },
  },
}));

// El fetch de los bytes del media (segundo paso de downloadGraphMedia).
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("ensureAssetAvailable — transcripción de audio (awaitTranscription)", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("MEDIA_DIR", "./.test-media");

    transcribeAudio.mockReset();
    graphRequest.mockReset();
    getCredentialsByOrg.mockReset();
    fetchMock.mockReset();
    updates.length = 0;
    selectQueue.length = 0;

    getCredentialsByOrg.mockResolvedValue({
      token: "token-test",
      phoneNumberId: "pnid_1",
      organizationId: "org_1",
    });
    graphRequest.mockResolvedValue({
      url: "https://graph.example/media/1",
      mime_type: "audio/ogg",
      file_size: 4,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "audio/ogg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("transcripción falla (ok:false) → transcribeError persistido, sin caption, log emitido", async () => {
    transcribeAudio.mockResolvedValue({
      ok: false,
      error: "sin voz entendible",
    });
    selectQueue.push([
      {
        id: "ma_1",
        organizationId: "org_1",
        kind: "audio",
        waMediaId: "wamid_1",
        mimeType: null,
        caption: null,
        fetchStatus: "pending",
      },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { ensureAssetAvailable } = await import("@/server/whatsapp/media");
    await ensureAssetAvailable("org_1", "ma_1", { awaitTranscription: true });

    // Primer update: fetchStatus → available. Segundo: el de la transcripción.
    const transcribeUpdate = updates.find(
      (u) => "transcribeError" in (u.set as Record<string, unknown>)
    );
    expect(transcribeUpdate).toBeDefined();
    expect((transcribeUpdate!.set as Record<string, unknown>).transcribeError).toBe(
      "sin voz entendible"
    );
    expect((transcribeUpdate!.set as Record<string, unknown>).caption).toBeUndefined();
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("sin voz entendible"))
    ).toBe(true);

    warn.mockRestore();
  });

  it("transcripción exitosa → caption persistido y transcribeError limpiado", async () => {
    transcribeAudio.mockResolvedValue({
      ok: true,
      text: "hola, quiero información",
    });
    selectQueue.push([
      {
        id: "ma_1",
        organizationId: "org_1",
        kind: "audio",
        waMediaId: "wamid_1",
        mimeType: null,
        caption: null,
        fetchStatus: "pending",
      },
    ]);
    selectQueue.push([]); // select del mensaje asociado (publish), sin fila: no rompe

    const { ensureAssetAvailable } = await import("@/server/whatsapp/media");
    await ensureAssetAvailable("org_1", "ma_1", { awaitTranscription: true });

    const captionUpdate = updates.find(
      (u) => "caption" in (u.set as Record<string, unknown>)
    );
    expect(captionUpdate).toBeDefined();
    const set = captionUpdate!.set as Record<string, unknown>;
    expect(set.caption).toBe("hola, quiero información");
    expect(set.transcribeError).toBeNull();
  });
});
