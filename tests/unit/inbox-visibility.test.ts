import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { conversationVisibilityWhere } from "@/server/inbox/queries";

/**
 * Auditoría 2026-09-17 — filtros funcionales/de sistema y archivado (hallazgo
 * "un contacto archivado sigue visible en Bandeja"). `conversationVisibilityWhere`
 * es el único lugar que decide qué conversación entra a la Bandeja; se prueba
 * aquí para no repetir el criterio ni dejar que un cambio futuro lo rompa en
 * silencio.
 */
describe("conversationVisibilityWhere", () => {
  it("por defecto excluye datos de prueba/sistema Y contactos archivados", () => {
    const query = new PgDialect().sqlToQuery(
      conversationVisibilityWhere("org_a")
    );
    expect(query.sql).toContain("sample_type");
    expect(query.sql).toContain("archived_at");
    expect(query.sql.toLowerCase()).toContain("is null");
    expect(query.params).toContain("org_a");
  });

  it("includeArchived agrega los archivados sin dejar de excluir sample_type", () => {
    const query = new PgDialect().sqlToQuery(
      conversationVisibilityWhere("org_a", { includeArchived: true })
    );
    expect(query.sql).toContain("sample_type");
    expect(query.sql).not.toContain("archived_at");
  });

  it("con `since` agrega el filtro de catch-up sobre updated_at", () => {
    const since = new Date("2026-09-17T00:00:00Z");
    const query = new PgDialect().sqlToQuery(
      conversationVisibilityWhere("org_a", { since })
    );
    expect(query.sql).toContain("updated_at");
    expect(query.params).toContain(since.toISOString());
  });
});
