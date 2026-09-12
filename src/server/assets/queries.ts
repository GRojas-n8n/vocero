import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/** 020 — Lecturas de activos de cliente. */

export type ClientAssetType =
  | "domain"
  | "vps"
  | "wordpress"
  | "github"
  | "cloudflare"
  | "other";

/** Lo que puede ver el cliente sin pedir explícitamente la clave: nunca el
 *  secreto en claro, solo si existe uno guardado. */
export type ClientAssetSummary = {
  id: string;
  leadId: string;
  type: ClientAssetType;
  name: string;
  url: string | null;
  username: string | null;
  hasSecret: boolean;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = typeof schema.clientAsset.$inferSelect;

function toSummary(row: Row): ClientAssetSummary {
  return {
    id: row.id,
    leadId: row.leadId,
    type: row.type,
    name: row.name,
    url: row.url,
    username: row.username,
    hasSecret: row.secretCipher !== null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Activos de un trato, más reciente primero. */
export async function listClientAssets(
  organizationId: string,
  leadId: string
): Promise<ClientAssetSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.clientAsset)
    .where(
      scoped(
        schema.clientAsset.organizationId,
        organizationId,
        eq(schema.clientAsset.leadId, leadId)
      )
    )
    .orderBy(desc(schema.clientAsset.createdAt));
  return rows.map(toSummary);
}

export async function getClientAssetRow(
  organizationId: string,
  assetId: string
): Promise<Row | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.clientAsset)
    .where(
      scoped(
        schema.clientAsset.organizationId,
        organizationId,
        eq(schema.clientAsset.id, assetId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getClientAsset(
  organizationId: string,
  assetId: string
): Promise<ClientAssetSummary | null> {
  const row = await getClientAssetRow(organizationId, assetId);
  return row ? toSummary(row) : null;
}

/** ¿Ese trato es de esta organización? (multi-tenancy: III). */
export async function leadBelongsToOrg(
  organizationId: string,
  leadId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.id, leadId)
      )
    )
    .limit(1);
  return rows.length > 0;
}
