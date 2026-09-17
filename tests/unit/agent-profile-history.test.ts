import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 6 (auditoría 2026-09) — antes, "Guardar comportamiento" publicaba
 * directo a producción sin vista previa ni forma de volver atrás. Estos
 * tests fijan el contrato del historial (`agent_profile_version`, una pila
 * de deshacer): solo se guarda algo cuando de verdad cambia un campo de
 * COMPORTAMIENTO (nunca por el toggle `enabled` a secas), y revertir nunca
 * pierde el estado que reemplaza.
 */

const inserted: { values: Record<string, unknown> }[] = [];
const updated: { set: Record<string, unknown> }[] = [];
const selectQueue: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) {
        chain[m] = () => chain;
      }
      chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
      return chain;
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ values });
        return Promise.resolve([values]);
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updated.push({ set });
        return { where: () => Promise.resolve([]) };
      },
    }),
  }),
  schema: {
    agentProfileVersion: {
      id: "id",
      organizationId: "organizationId",
      createdAt: "createdAt",
      changedByUserId: "changedByUserId",
    },
    agentProfile: { organizationId: "organizationId" },
    user: { id: "id", name: "name" },
  },
}));

const CURRENT = {
  name: "Max",
  tone: "cercano",
  instructions: "responde rápido",
  escalationRules: "escala si se enoja",
  greeting: "¡Hola!",
};

describe("snapshotIfChanged", () => {
  beforeEach(() => {
    inserted.length = 0;
    updated.length = 0;
    selectQueue.length = 0;
  });

  it("un PATCH que solo toca `enabled` no genera versión (no es comportamiento)", async () => {
    const { snapshotIfChanged } = await import("@/server/agent/profile-history");
    await snapshotIfChanged("org_1", CURRENT, {}, "user_1");
    expect(inserted).toHaveLength(0);
  });

  it("cambiar `instructions` guarda el estado VIEJO completo, no el nuevo", async () => {
    const { snapshotIfChanged } = await import("@/server/agent/profile-history");
    await snapshotIfChanged(
      "org_1",
      CURRENT,
      { instructions: "nunca ofrezcas descuentos" },
      "user_1"
    );
    expect(inserted).toHaveLength(1);
    const saved = inserted[0]!.values;
    expect(saved.instructions).toBe("responde rápido"); // el viejo, no el nuevo
    expect(saved.name).toBe("Max");
    expect(saved.changedByUserId).toBe("user_1");
  });

  it("un patch idéntico al valor actual no cuenta como cambio", async () => {
    const { snapshotIfChanged } = await import("@/server/agent/profile-history");
    await snapshotIfChanged("org_1", CURRENT, { tone: "cercano" }, "user_1");
    expect(inserted).toHaveLength(0);
  });
});

describe("restoreVersion", () => {
  beforeEach(() => {
    inserted.length = 0;
    updated.length = 0;
    selectQueue.length = 0;
  });

  it("versión inexistente → VersionNotFoundError, sin tocar el perfil", async () => {
    const { restoreVersion, VersionNotFoundError } = await import(
      "@/server/agent/profile-history"
    );
    selectQueue.push([]); // no encuentra la versión
    await expect(
      restoreVersion("org_1", "agpv_x", "user_1")
    ).rejects.toBeInstanceOf(VersionNotFoundError);
    expect(updated).toHaveLength(0);
  });

  it("revertir guarda el estado ACTUAL en el historial antes de sobrescribirlo", async () => {
    const { restoreVersion } = await import("@/server/agent/profile-history");
    const oldVersion = {
      id: "agpv_1",
      name: "Max viejo",
      tone: "formal",
      instructions: "instrucciones viejas",
      escalationRules: null,
      greeting: null,
    };
    selectQueue.push([oldVersion]); // la versión a restaurar
    selectQueue.push([CURRENT]); // el perfil vigente ANTES de revertir

    await restoreVersion("org_1", "agpv_1", "user_2");

    // El estado que estaba vigente (CURRENT) queda guardado como versión.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.values.instructions).toBe(CURRENT.instructions);
    expect(inserted[0]!.values.changedByUserId).toBe("user_2");

    // Y el perfil vigente pasa a ser el de la versión restaurada.
    expect(updated).toHaveLength(1);
    expect(updated[0]!.set.instructions).toBe("instrucciones viejas");
    expect(updated[0]!.set.name).toBe("Max viejo");
  });
});
