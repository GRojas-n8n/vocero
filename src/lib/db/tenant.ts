import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Scope de tenant obligatorio (Constitución III).
 *
 * Toda query de dominio se construye con `scoped(...)`: exige el
 * organization_id explícito y lo combina con el resto de condiciones,
 * de modo que un WHERE sin tenant no compile de forma natural.
 */
export function scoped(
  organizationColumn: PgColumn,
  organizationId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  if (!organizationId) {
    throw new Error("scoped(): organizationId vacío — query sin tenant");
  }
  const base = eq(organizationColumn, organizationId);
  const rest = conditions.filter((c): c is SQL => c !== undefined);
  return rest.length > 0 ? and(base, ...rest)! : base;
}

/**
 * Fase 4 (auditoría 2026-09) — excluye de una query de dominio los leads o
 * conversaciones cuyo CONTACTO está marcado a mano como `demo` o `system`
 * (`contact.sample_type`, ver schema.ts). Sin esto, el negocio de
 * demostración de `seedDemo` o el contacto que crea el botón "Enviar
 * mensaje" de developers.facebook.com ("WhatsApp Business") se cuentan como
 * prospectos reales en Resultados/Pipeline/Bandeja.
 *
 * Se pasa como una condición MÁS a `scoped(...)`, igual que cualquier otra:
 * `scoped(schema.lead.organizationId, orgId, excludingSampleContacts(schema.lead.contactId))`.
 */
export function excludingSampleContacts(contactIdColumn: PgColumn): SQL {
  return sql`not exists (
    select 1 from contact c
    where c.id = ${contactIdColumn} and c.sample_type is not null
  )`;
}
