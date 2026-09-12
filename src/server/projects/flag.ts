/**
 * 021 — Si esta instancia tiene Proyectos e hitos o no.
 *
 * Mismo patrón que Cotizaciones y Activos (`src/server/quotes/flag.ts`,
 * `src/server/assets/flag.ts`): el código viaja siempre en main, y lo que
 * decide si EXISTE para el usuario es una variable de despliegue. Una
 * instancia sin `PROJECTS` no ve el módulo por ningún lado: ni pantalla de
 * Proyectos, ni botón en la tarjeta del trato, ni rutas (responden 404). La
 * automatización que crea el proyecto al aceptar una cotización tampoco
 * corre si la bandera está apagada.
 *
 * La migración se aplica siempre: unas tablas vacías son inertes.
 */

const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseProjectsFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()` — igual que
 * `quotesEnabled()`.
 */
export function projectsEnabled(): boolean {
  return parseProjectsFlag(process.env.PROJECTS);
}

/** 404 y no 403 a propósito: si el módulo no está encendido, esa ruta no
 *  existe en esta instancia — no hay nada que revelar sobre ella. */
export function projectsDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
