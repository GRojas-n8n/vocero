/**
 * Enlaces "precargar y que el prospecto confirme Guardar" para Google
 * Calendar y Outlook — la misma cita que ya vive en `.ics` (`lib/ics.ts`),
 * pero como URL que el navegador abre directo en el calendario del proveedor
 * en vez de descargar un archivo.
 *
 * Sin dependencia ni credencial: son enlaces públicos de "nuevo evento
 * precargado" (el mismo patrón que Calendly/Eventbrite), nunca una API que
 * escriba en el calendario de nadie. Ninguno de los dos promete que la cita
 * quede agendada sola — el proveedor exige que la persona pulse Guardar en su
 * propia pantalla.
 */

export type CalendarLinkInput = {
  title: string;
  startUtc: string;
  durationMinutes: number;
  description?: string;
  location?: string;
  timezone: string;
};

function formatUtcCompact(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** "Nuevo evento" precargado de Google Calendar — el visitante confirma Guardar. */
export function googleCalendarUrl(input: CalendarLinkInput): string {
  const start = new Date(input.startUtc);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${formatUtcCompact(start)}/${formatUtcCompact(end)}`,
    ctz: input.timezone,
  });
  if (input.description) params.set("details", input.description);
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** "Nuevo evento" precargado de Outlook — mismo trato: el visitante confirma Guardar. */
export function outlookCalendarUrl(input: CalendarLinkInput): string {
  const start = new Date(input.startUtc);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    subject: input.title,
  });
  if (input.description) params.set("body", input.description);
  if (input.location) params.set("location", input.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
