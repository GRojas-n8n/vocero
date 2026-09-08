/**
 * CLI del seed de MÁS Impulso Digital: `pnpm seed:mas-impulso [-- <organizationId>]`
 * (local) o dentro del contenedor. Configura el agent_profile + KB de la
 * organización; no toca contactos/leads. Se bundlea con esbuild (alias
 * @ → ./src).
 *
 * El organization_id es OBLIGATORIO en cuanto haya más de una organización
 * en la base (p. ej. producción): ahí no hay "primera organización" segura
 * que adivinar. Con exactamente una, se puede omitir por conveniencia local.
 */
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { seedMasImpulso } from "@/server/seed/mas-impulso";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const argOrgId = process.argv
  .slice(2)
  .map((a) => (a.startsWith("--org=") ? a.slice("--org=".length) : a))
  .find((a) => !a.startsWith("--"));

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

let org: { id: string } | undefined;
if (argOrgId) {
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, argOrgId))
    .limit(1);
  org = rows[0];
  if (!org) {
    console.error(`[seed] No existe una organización con id "${argOrgId}"`);
    await sql.end();
    process.exit(1);
  }
} else {
  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .limit(2);
  if (orgs.length === 0) {
    console.error(
      "[seed] No hay organización: regístrate primero en la app y vuelve a correr el seed"
    );
    await sql.end();
    process.exit(1);
  }
  if (orgs.length > 1) {
    console.error(
      "[seed] Hay más de una organización: pasa el organization_id explícito, ej. `pnpm seed:mas-impulso -- org_abc123`"
    );
    await sql.end();
    process.exit(1);
  }
  org = orgs[0];
}

const result = await seedMasImpulso(db, org!.id);
console.log(
  `[seed] Agente de MÁS Impulso Digital configurado en ${org!.id}: ${result.kbEntries} entradas de KB`
);
await sql.end();
process.exit(0);
