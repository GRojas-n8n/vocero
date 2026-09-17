import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-09-16 — Bug reportado: un adjunto cuya URL Meta ya expiró (404/410,
 * fallo DEFINITIVO — nunca va a funcionar) se reintentaba contra Graph en
 * CADA visita al hilo (`/api/media/[assetId]` llama a `ensureAssetAvailable`
 * on-demand siempre que `fetchStatus !== "available"`). Estos tests fijan
 * que un fallo definitivo se recuerda y deja de reintentarse, mientras que
 * uno transitorio (sin confirmación de que esté gone) SÍ se reintenta la
 * próxima vez — no hay forma de saber si ya se resolvió sin probar.
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

const selectQueue: unknown[][] = [];
const updates: { set: Record<string, unknown> }[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "where"]) chain[m] = () => chain;
      chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
      return chain;
    },
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ set });
        return { where: () => ({ returning: () => Promise.resolve([{ ...set }]) }) };
      },
    }),
  }),
  schema: {
    mediaAsset: { id: "id", organizationId: "organizationId" },
    message: { mediaAssetId: "mediaAssetId" },
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ma_1",
    organizationId: "org_1",
    kind: "image",
    waMediaId: "wamid_1",
    mimeType: "image/jpeg",
    caption: null,
    fetchStatus: "pending",
    fetchError: null,
    ...overrides,
  };
}

describe("ensureAssetAvailable — no reintentar un fallo definitivo", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("MEDIA_DIR", "./.test-media");

    graphRequest.mockReset();
    getCredentialsByOrg.mockReset();
    fetchMock.mockReset();
    selectQueue.length = 0;
    updates.length = 0;
    getCredentialsByOrg.mockResolvedValue({
      token: "token-test",
      phoneNumberId: "pnid_1",
      organizationId: "org_1",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Meta responde 404 (gone) → marca fallo definitivo y NO reintenta en la próxima llamada", async () => {
    const { MetaApiError } = await import("@/lib/meta/client");
    graphRequest.mockRejectedValue(new MetaApiError("not found", { status: 404 }));

    selectQueue.push([assetRow({ fetchStatus: "failed" })]);
    const { ensureAssetAvailable, describeFetchError } = await import(
      "@/server/whatsapp/media"
    );

    const first = await ensureAssetAvailable("org_1", "ma_1");
    expect(first).toBeNull(); // la descarga en sí falló, como antes
    expect(getCredentialsByOrg).toHaveBeenCalledTimes(1);
    const failUpdate = updates.find((u) => u.set.fetchStatus === "failed");
    expect(failUpdate).toBeDefined();
    const storedError = failUpdate!.set.fetchError as string;
    // Legible para el operador, sin la jerga interna del marcador.
    expect(describeFetchError(storedError)).toMatch(/metadata/i);

    // Segunda llamada: el asset YA está "failed" con ese motivo persistido.
    selectQueue.push([assetRow({ fetchStatus: "failed", fetchError: storedError })]);
    getCredentialsByOrg.mockClear();
    const second = await ensureAssetAvailable("org_1", "ma_1");
    expect(second).toMatchObject({ fetchStatus: "failed" });
    expect(getCredentialsByOrg).not.toHaveBeenCalled();
    expect(graphRequest).toHaveBeenCalledTimes(1); // no una segunda vez
  });

  it("fallo transitorio (sin confirmación de 'gone') → SÍ reintenta en la próxima llamada", async () => {
    graphRequest.mockRejectedValue(new Error("network blip"));
    selectQueue.push([assetRow({ fetchStatus: "failed" })]);
    const { ensureAssetAvailable } = await import("@/server/whatsapp/media");

    await ensureAssetAvailable("org_1", "ma_1");
    expect(getCredentialsByOrg).toHaveBeenCalledTimes(1);
    const failUpdate = updates.find((u) => u.set.fetchStatus === "failed");
    const storedError = failUpdate!.set.fetchError as string;

    selectQueue.push([assetRow({ fetchStatus: "failed", fetchError: storedError })]);
    getCredentialsByOrg.mockClear();
    await ensureAssetAvailable("org_1", "ma_1");
    expect(getCredentialsByOrg).toHaveBeenCalledTimes(1); // sí reintentó
  });
});
