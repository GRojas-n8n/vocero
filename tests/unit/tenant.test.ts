import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { excludingSampleContacts, scoped } from "@/lib/db/tenant";
import { schema } from "@/lib/db";

/**
 * FR-085: ninguna query de dominio sin ámbito de tenant. El helper `scoped`
 * es la única vía de WHERE en el código de dominio; aquí se verifica su
 * contrato. El aislamiento vivo se ejercita en el E2E (una sola org por
 * instancia + queries siempre scoped).
 */
describe("scoped (aislamiento por organización)", () => {
  it("organizationId vacío lanza — imposible una query sin tenant", () => {
    expect(() => scoped(schema.contact.organizationId, "")).toThrow(
      /sin tenant/
    );
  });

  it("produce el filtro de organización solo", () => {
    const condition = scoped(schema.contact.organizationId, "org_a");
    expect(condition).toBeDefined();
  });

  it("combina la organización con condiciones extra (AND)", () => {
    const condition = scoped(
      schema.contact.organizationId,
      "org_a",
      eq(schema.contact.phone, "521551111"),
      undefined // condiciones opcionales se filtran
    );
    expect(condition).toBeDefined();
    // el SQL generado contiene ambas columnas unidas por AND
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain("organization_id");
    expect(query.sql).toContain("phone");
    expect(query.sql.toLowerCase()).toContain("and");
    expect(query.params).toContain("org_a");
  });
});

/**
 * Fase 4 (auditoría 2026-09): datos de demostración (`seedDemo`, "Ferretería
 * El Martillo") y contactos del sistema (p. ej. "WhatsApp Business" del botón
 * de prueba de Meta) no deben contaminar Resultados/Pipeline/Bandeja. Este
 * helper es el único punto que decide la exclusión — se prueba aquí para no
 * repetir la lógica de un NOT EXISTS en cada query de metrics.ts.
 */
describe("excludingSampleContacts (Fase 4 — aislar datos de demo/sistema)", () => {
  it("genera un NOT EXISTS sobre contact.sample_type sin tocar el resto del WHERE", () => {
    const condition = scoped(
      schema.lead.organizationId,
      "org_a",
      excludingSampleContacts(schema.lead.contactId)
    );
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain("not exists");
    expect(query.sql).toContain("sample_type");
    expect(query.sql).toContain("organization_id");
    expect(query.params).toContain("org_a");
  });

  it("referencia la columna de contacto pasada, no una fija", () => {
    const forLead = new PgDialect().sqlToQuery(
      excludingSampleContacts(schema.lead.contactId)
    );
    const forConversation = new PgDialect().sqlToQuery(
      excludingSampleContacts(schema.conversation.contactId)
    );
    expect(forLead.sql).toContain("lead");
    expect(forConversation.sql).toContain("conversation");
  });
});
