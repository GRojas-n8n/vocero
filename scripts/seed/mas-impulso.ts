/**
 * CLI del seed de MÁS Impulso Digital: `pnpm seed:mas-impulso` (local) o
 * dentro del contenedor. Configura el agent_profile + KB de la organización;
 * no toca contactos/leads. Se bundlea con esbuild (alias @ → ./src).
 */
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

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const orgs = await db.select().from(schema.organization).limit(1);
const org = orgs[0];
if (!org) {
  console.error(
    "[seed] No hay organización: regístrate primero en la app y vuelve a correr el seed"
  );
  await sql.end();
  process.exit(1);
}

const result = await seedMasImpulso(db, org.id);
console.log(
  `[seed] Agente de MÁS Impulso Digital configurado: ${result.kbEntries} entradas de KB`
);
await sql.end();
process.exit(0);
