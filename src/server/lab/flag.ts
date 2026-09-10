/**
 * Si esta instancia tiene el Laboratorio de auto-evaluación o no.
 *
 * Mismo patrón que la agenda (ADR-001, ver `server/agenda/flag.ts`): el
 * código del Laboratorio viaja siempre en main, y lo que decide si EXISTE
 * para el usuario es una variable de despliegue. Una instancia normal (sin
 * `LAB`) no ve el Laboratorio por ningún lado: ni entrada en el menú, ni
 * ruta `/lab`.
 *
 * Apagado por defecto porque es una herramienta de desarrollo/QA de la
 * agencia, no una superficie del MVP comercial (WhatsApp + captura +
 * seguimiento) que ve el negocio final.
 */

/** Valores que cuentan como "encendida". Cualquier otra cosa, apagada. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseLabFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()`, igual que
 * `agendaEnabled()`: preguntar si una feature existe no puede depender de
 * que TODO el entorno valide.
 *
 * `LAB` sí está declarada en el esquema de `lib/env.ts`: ahí vive su
 * documentación y su tipo. Lo que no pasa por el validador es esta consulta.
 */
export function labEnabled(): boolean {
  return parseLabFlag(process.env.LAB);
}

/**
 * Respuesta para una superficie del Laboratorio apagada. 404 y no 403 a
 * propósito: si LAB no está encendida, ese endpoint no existe en esta
 * instancia — no hay nada que revelar sobre él.
 */
export function labDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
