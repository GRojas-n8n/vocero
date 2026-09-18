import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría 2026-09-17 (incidente GRojas/Más Impulso) — `appendLeadNote`
 * concatenaba `[IA] {nota}` sin fin al `contact.notes` de texto libre: diez
 * turnos producían diez párrafos acumulativos, mezclaban giros de negocio
 * incompatibles y presentaban inferencias como hechos confirmados, todo en
 * el mismo campo que el dueño edita a mano.
 *
 * `recordAiNote` (server/contacts/notes.ts) lo reemplaza: un hecho atómico
 * por fila, deduplicado, con origen y estado de confirmación. Estos tests
 * fijan:
 * - una conversación real no muta el estado por reintentos/ráfagas (dedup).
 * - un giro que no coincide con el ya confirmado para el contacto se guarda
 *   como `conflict`, nunca fusionado bajo `confirmed`.
 * - el Laboratorio (`isTest`) siempre guarda `test`, sin importar el giro.
 * - una nota vacía tras recortar no llega a insertarse.
 */

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectQueue: unknown[][] = [];
const inserts: { values: Record<string, unknown> }[] = [];
let conflictOnInsert = false;

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => makeSelectChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ values });
        return {
          onConflictDoNothing: () => ({
            returning: () =>
              Promise.resolve(conflictOnInsert ? [] : [{ id: values.id }]),
          }),
        };
      },
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy(
          {},
          { get: (_t2, col) => `${String(tableName)}.${String(col)}` }
        ),
    }
  ),
}));

describe("hashNoteText / scenarioConflicts — lógica pura", () => {
  it("normaliza espacios y mayúsculas: el mismo hecho hashea igual", async () => {
    const { hashNoteText } = await import("@/server/contacts/notes");
    expect(hashNoteText("Quiere  cotización  de tinacos")).toBe(
      hashNoteText("quiere cotización de tinacos")
    );
    expect(hashNoteText("  Quiere cotización de tinacos  ")).toBe(
      hashNoteText("quiere cotización de tinacos")
    );
  });

  it("textos distintos → hashes distintos", async () => {
    const { hashNoteText } = await import("@/server/contacts/notes");
    expect(hashNoteText("quiere tinacos")).not.toBe(hashNoteText("quiere bombas"));
  });

  it("scenarioConflicts: sin establecido o sin entrante → nunca hay choque", async () => {
    const { scenarioConflicts } = await import("@/server/contacts/notes");
    expect(scenarioConflicts(null, "plomería")).toBe(false);
    expect(scenarioConflicts("plomería", null)).toBe(false);
    expect(scenarioConflicts(null, null)).toBe(false);
  });

  it("scenarioConflicts: mismo giro (con variación de mayúsculas/espacios) → sin choque", async () => {
    const { scenarioConflicts } = await import("@/server/contacts/notes");
    expect(scenarioConflicts("Plomería", " plomería ")).toBe(false);
  });

  it("scenarioConflicts: giros distintos → choque", async () => {
    const { scenarioConflicts } = await import("@/server/contacts/notes");
    expect(scenarioConflicts("plomería", "clínica dental")).toBe(true);
  });
});

describe("recordAiNote", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    inserts.length = 0;
    conflictOnInsert = false;
  });

  it("nota vacía tras recortar → no inserta nada", async () => {
    const { recordAiNote } = await import("@/server/contacts/notes");
    const result = await recordAiNote({
      organizationId: "org_1",
      contactId: "ct_1",
      note: "   ",
      isTest: false,
    });
    expect(result).toBeNull();
    expect(inserts).toHaveLength(0);
  });

  it("primer hecho confirmado de un contacto sin giro previo → confirmed", async () => {
    selectQueue.push([]); // sin escenario confirmado previo
    const { recordAiNote } = await import("@/server/contacts/notes");
    const result = await recordAiNote({
      organizationId: "org_1",
      contactId: "ct_1",
      note: "Quiere cotización de tinacos",
      scenario: "plomería",
      isTest: false,
      sourceMessageId: "msg_1",
    });
    expect(result).toEqual({ status: "confirmed", deduped: false });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values.status).toBe("confirmed");
    expect(inserts[0]!.values.scenario).toBe("plomería");
  });

  it("giro distinto al ya confirmado del mismo contacto → conflict, nunca se fusiona", async () => {
    selectQueue.push([{ scenario: "plomería" }]); // último confirmado
    const { recordAiNote } = await import("@/server/contacts/notes");
    const result = await recordAiNote({
      organizationId: "org_1",
      contactId: "ct_1",
      note: "Pregunta por limpieza dental",
      scenario: "clínica dental",
      isTest: false,
    });
    expect(result?.status).toBe("conflict");
    expect(inserts[0]!.values.status).toBe("conflict");
  });

  it("conversación del Laboratorio → siempre test, aunque el giro coincida", async () => {
    const { recordAiNote } = await import("@/server/contacts/notes");
    const result = await recordAiNote({
      organizationId: "org_1",
      contactId: "ct_lab",
      note: "Simulación: pregunta por tinacos",
      scenario: "plomería",
      isTest: true,
    });
    expect(result?.status).toBe("test");
    // El Laboratorio nunca consulta el giro confirmado: no debió leer nada.
    expect(selectQueue).toHaveLength(0);
  });

  it("reintento del mismo hecho (mismo hash) → dedup, no una fila nueva por turno", async () => {
    selectQueue.push([]);
    conflictOnInsert = true;
    const { recordAiNote } = await import("@/server/contacts/notes");
    const result = await recordAiNote({
      organizationId: "org_1",
      contactId: "ct_1",
      note: "Quiere cotización de tinacos",
      isTest: false,
    });
    expect(result).toEqual({ status: "confirmed", deduped: true });
    expect(inserts).toHaveLength(1); // se intentó, pero la UNIQUE lo descartó
  });

  it("recorta una nota que exceda MAX_NOTE_LEN en vez de guardar un párrafo entero", async () => {
    selectQueue.push([]);
    const { recordAiNote, MAX_NOTE_LEN } = await import(
      "@/server/contacts/notes"
    );
    const long = "x".repeat(MAX_NOTE_LEN + 50);
    await recordAiNote({
      organizationId: "org_1",
      contactId: "ct_1",
      note: long,
      isTest: false,
    });
    expect((inserts[0]!.values.text as string).length).toBe(MAX_NOTE_LEN);
  });
});
