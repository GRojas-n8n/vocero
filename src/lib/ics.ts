/**
 * Generador mínimo de un archivo .ics (RFC 5545) para UN evento.
 *
 * Deliberadamente sin dependencia externa (soberanía): las fechas se escriben
 * en UTC (`...Z`), así que ningún cliente de calendario necesita un bloque
 * VTIMEZONE — cada quien lo muestra ya convertido a su hora local.
 */

function foldLine(line: string): string {
  // RFC 5545 §3.1: una línea de más de 75 octetos se parte con CRLF + espacio.
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    out += "\r\n " + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function buildEventIcs(input: {
  uid: string;
  startUtc: string;
  durationMinutes: number;
  summary: string;
  description?: string;
  location?: string;
  organizerName?: string;
}): string {
  const start = new Date(input.startUtc);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const now = new Date();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vocero CRM//Agenda//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeText(input.summary)}`,
  ];
  if (input.description) {
    lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeText(input.location)}`);
  }
  if (input.organizerName) {
    lines.push(
      `ORGANIZER;CN=${escapeText(input.organizerName)}:MAILTO:noreply@noreply.invalid`
    );
  }
  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
