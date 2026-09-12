/**
 * 020 — Si esta instancia tiene Activos de cliente o no.
 *
 * Mismo patrón que Cotizaciones (`src/server/quotes/flag.ts`): el código
 * viaja siempre en main, y lo que decide si EXISTE para el usuario es una
 * variable de despliegue. Una instancia sin `ASSETS` no ve el módulo por
 * ningún lado: ni pestaña en el trato, ni rutas (responden 404).
 *
 * La migración se aplica siempre: una tabla vacía es inerte.
 */

const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseAssetsFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()` — igual que
 * `quotesEnabled()`: preguntar si una feature existe no puede depender de
 * que TODO el entorno valide.
 */
export function assetsEnabled(): boolean {
  return parseAssetsFlag(process.env.ASSETS);
}

/** 404 y no 403 a propósito: si el módulo no está encendido, esa ruta no
 *  existe en esta instancia — no hay nada que revelar sobre ella. */
export function assetsDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
