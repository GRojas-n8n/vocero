/**
 * 019 — Si esta instancia tiene cotizaciones o no.
 *
 * Mismo patrón que la agenda (ADR-001, `src/server/agenda/flag.ts`): el
 * código viaja siempre en main, y lo que decide si EXISTE para el usuario es
 * una variable de despliegue. Una instancia sin `QUOTES` no ve el módulo por
 * ningún lado: ni pantalla de Cotizaciones, ni botón en la tarjeta del lead,
 * ni rutas (responden 404).
 *
 * La migración se aplica siempre: unas tablas vacías son inertes.
 */

const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseQuotesFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()` — igual que
 * `agendaEnabled()`: preguntar si una feature existe no puede depender de
 * que TODO el entorno valide.
 */
export function quotesEnabled(): boolean {
  return parseQuotesFlag(process.env.QUOTES);
}

/** 404 y no 403 a propósito: si el módulo no está encendido, esa ruta no
 *  existe en esta instancia — no hay nada que revelar sobre ella. */
export function quotesDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
