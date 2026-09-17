/**
 * Parsea `Range: bytes=start-end` (RFC 7233), incluido el sufijo `bytes=-N`
 * (últimos N bytes). Soporta un solo rango — es lo único que piden
 * `<audio>`/`<video>`; un rango múltiple o inválido devuelve `null` y el
 * llamador sirve el archivo completo, que sigue siendo correcto.
 *
 * Sin esto, el `<audio>`/`<video>` del navegador no puede calcular la
 * duración ni buscar dentro del archivo — se queda mostrando 0:00 aunque el
 * archivo esté perfectamente sano (bug 2026-09-16, reportado sobre una nota
 * de voz de Diego en MÁS Impulso: el audio y la transcripción estaban bien,
 * el reproductor simplemente no podía calcular la duración sin poder pedir
 * un rango de bytes).
 */
export function parseRangeHeader(
  header: string | null,
  size: number
): { start: number; end: number } | null {
  if (!header?.startsWith("bytes=") || size === 0) return null;
  const spec = header.slice("bytes=".length).split(",")[0]?.trim();
  const match = spec?.match(/^(\d*)-(\d*)$/);
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return null;
  let start = startStr ? Number(startStr) : size - Number(endStr);
  let end = endStr && startStr ? Number(endStr) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end) return null;
  return { start, end };
}
