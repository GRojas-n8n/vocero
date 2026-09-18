/**
 * Auditoría 2026-09-17 — candidatos a `contact.sample_type` entre contactos
 * YA EXISTENTES (de antes de que ese campo existiera, ver Fase 4 / commit
 * b097f9f). Requisito explícito de esa auditoría: "no reclasifiques
 * automáticamente contactos reales basándote solo en nombres o notas" y "no
 * migres ni reclasifiques datos de producción sin aprobación específica".
 *
 * Este script es 100% de LECTURA: nunca escribe, nunca decide, nunca corre
 * solo. Imprime una lista para que un humano revise y, si corresponde,
 * reclasifique CADA contacto a mano desde Contactos → Editar → "Tipo de
 * dato" (la acción explícita ya existe en la UI). Los criterios son
 * DELIBERADAMENTE estrechos — coinciden con artefactos conocidos, no con
 * "se parece a una prueba":
 *
 *  - Nombre EXACTO "WhatsApp Business" (sin distinguir mayúsculas/acentos):
 *    el contacto que crea el botón "Enviar mensaje" del panel de
 *    developers.facebook.com al probar el webhook (ver schema.ts, comentario
 *    de `contact.sampleType`).
 *  - Teléfonos de `DEMO_CONTACTS` en server/seed/demo.ts que NO quedaron
 *    marcados `sampleType = 'demo'`: instancias que cargaron el demo ANTES
 *    de que ese campo existiera. (Nota: volver a pulsar "Cargar datos de
 *    demostración" en la Bandeja vacía también los corrige, porque el seed
 *    es idempotente y ya inserta `sampleType: 'demo'` — este script solo
 *    ayuda a confirmar que hace falta.)
 *
 * Uso:
 *   node --env-file=.env scripts/audit-sample-candidates.mjs
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[audit] DATABASE_URL no está definida");
  process.exit(1);
}

// Mismos teléfonos que DEMO_CONTACTS en server/seed/demo.ts — duplicados aquí
// a propósito: este script es de solo lectura y no debe importar código de
// la app (evita arrastrar su config/entorno de build).
const DEMO_PHONES = [
  "5215612340001",
  "5215612340002",
  "5215612340003",
  "5215612340004",
  "5215612340005",
  "5215612340006",
  "5215612340007",
  "5215612340008",
];

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const systemCandidates = await sql`
    select id, organization_id, name, phone, created_at
    from contact
    where sample_type is null
      and lower(name) = 'whatsapp business'
    order by organization_id, created_at
  `;

  const demoCandidates = await sql`
    select id, organization_id, name, phone, created_at
    from contact
    where sample_type is null
      and phone = any(${DEMO_PHONES})
    order by organization_id, created_at
  `;

  if (systemCandidates.length === 0 && demoCandidates.length === 0) {
    console.log(
      "[audit] Sin candidatos: ningún contacto sin clasificar coincide con " +
        "los patrones conocidos de sistema/demo."
    );
  }

  if (systemCandidates.length > 0) {
    console.log(
      `\n[audit] ${systemCandidates.length} candidato(s) a "system" ` +
        `(nombre exacto "WhatsApp Business", el del botón de prueba de Meta):`
    );
    for (const c of systemCandidates) {
      console.log(
        `  org=${c.organization_id}  contact=${c.id}  phone=${c.phone ?? "—"}  creado=${c.created_at.toISOString()}`
      );
    }
  }

  if (demoCandidates.length > 0) {
    console.log(
      `\n[audit] ${demoCandidates.length} candidato(s) a "demo" ` +
        `(teléfono de la ferretería de ejemplo, cargados antes de Fase 4):`
    );
    for (const c of demoCandidates) {
      console.log(
        `  org=${c.organization_id}  contact=${c.id}  name="${c.name}"  creado=${c.created_at.toISOString()}`
      );
    }
    console.log(
      "\n  Corrección sugerida para estos: repetir \"Cargar datos de " +
        "demostración\" en esa organización (Bandeja vacía) — el seed es " +
        "idempotente y ya marca sampleType='demo' al reinsertar."
    );
  }

  if (systemCandidates.length > 0) {
    console.log(
      "\n  Corrección para los de \"system\": abrir el contacto en Contactos " +
        "→ Editar → \"Tipo de dato\" → \"Contacto del sistema\". NO se " +
        "reclasifica desde este script."
    );
  }
} finally {
  await sql.end();
}
