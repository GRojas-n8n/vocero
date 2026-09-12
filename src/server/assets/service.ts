import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import {
  getClientAsset,
  getClientAssetRow,
  leadBelongsToOrg,
  type ClientAssetSummary,
  type ClientAssetType,
} from "@/server/assets/queries";

/**
 * 020 — CRUD de activos de cliente.
 *
 * El secreto se cifra en esta capa y NUNCA sale de aquí en claro salvo por
 * `revealClientAssetSecret`, que es la única puerta que descifra — igual que
 * `decryptSecret` en `src/server/whatsapp/credentials.ts`. Las rutas nunca
 * tocan `lib/crypto` directo.
 */

export class AssetError extends Error {
  constructor(
    public code: "not_found" | "invalid",
    message: string
  ) {
    super(message);
    this.name = "AssetError";
  }
}

export async function createClientAsset(input: {
  organizationId: string;
  leadId: string;
  type: ClientAssetType;
  name: string;
  url: string | null;
  username: string | null;
  secret: string | null;
  expiresAt: string | null;
  notes: string | null;
}): Promise<ClientAssetSummary> {
  const belongs = await leadBelongsToOrg(input.organizationId, input.leadId);
  if (!belongs) throw new AssetError("not_found", "Ese trato no existe");
  if (!input.name.trim()) {
    throw new AssetError("invalid", "El activo necesita un nombre");
  }

  const enc = input.secret ? encryptSecret(input.secret) : null;
  const db = getDb();
  const id = newId("clientAsset");
  await db.insert(schema.clientAsset).values({
    id,
    organizationId: input.organizationId,
    leadId: input.leadId,
    type: input.type,
    name: input.name.trim(),
    url: input.url,
    username: input.username,
    secretCipher: enc?.cipher ?? null,
    secretIv: enc?.iv ?? null,
    secretTag: enc?.tag ?? null,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    notes: input.notes,
  });

  const created = await getClientAsset(input.organizationId, id);
  if (!created) throw new Error("el activo recién creado no se pudo leer");
  return created;
}

export async function updateClientAsset(input: {
  organizationId: string;
  assetId: string;
  type?: ClientAssetType;
  name?: string;
  url?: string | null;
  username?: string | null;
  /** undefined = no tocar el secreto; null = borrarlo; string = re-cifrarlo. */
  secret?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
}): Promise<ClientAssetSummary> {
  const current = await getClientAssetRow(input.organizationId, input.assetId);
  if (!current) throw new AssetError("not_found", "Ese activo no existe");
  if (input.name !== undefined && !input.name.trim()) {
    throw new AssetError("invalid", "El activo necesita un nombre");
  }

  const enc =
    input.secret === undefined
      ? undefined
      : input.secret === null
        ? null
        : encryptSecret(input.secret);

  const db = getDb();
  await db
    .update(schema.clientAsset)
    .set({
      type: input.type ?? current.type,
      name: input.name !== undefined ? input.name.trim() : current.name,
      url: input.url !== undefined ? input.url : current.url,
      username: input.username !== undefined ? input.username : current.username,
      ...(enc !== undefined
        ? {
            secretCipher: enc?.cipher ?? null,
            secretIv: enc?.iv ?? null,
            secretTag: enc?.tag ?? null,
          }
        : {}),
      expiresAt:
        input.expiresAt !== undefined
          ? input.expiresAt
            ? new Date(input.expiresAt)
            : null
          : current.expiresAt,
      notes: input.notes !== undefined ? input.notes : current.notes,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.clientAsset.organizationId,
        input.organizationId,
        eq(schema.clientAsset.id, input.assetId)
      )
    );

  const updated = await getClientAsset(input.organizationId, input.assetId);
  if (!updated) throw new Error("el activo actualizado no se pudo leer");
  return updated;
}

export async function deleteClientAsset(input: {
  organizationId: string;
  assetId: string;
}): Promise<void> {
  const db = getDb();
  const result = await db
    .delete(schema.clientAsset)
    .where(
      scoped(
        schema.clientAsset.organizationId,
        input.organizationId,
        eq(schema.clientAsset.id, input.assetId)
      )
    )
    .returning({ id: schema.clientAsset.id });
  if (result.length === 0) throw new AssetError("not_found", "Ese activo no existe");
}

/** Descifra el secreto para mostrarlo una sola vez a quien lo pide
 *  explícitamente. NULL si el activo no tiene secreto guardado. */
export async function revealClientAssetSecret(input: {
  organizationId: string;
  assetId: string;
}): Promise<string | null> {
  const row = await getClientAssetRow(input.organizationId, input.assetId);
  if (!row) throw new AssetError("not_found", "Ese activo no existe");
  if (!row.secretCipher || !row.secretIv || !row.secretTag) return null;
  return decryptSecret({
    cipher: row.secretCipher,
    iv: row.secretIv,
    tag: row.secretTag,
  });
}
