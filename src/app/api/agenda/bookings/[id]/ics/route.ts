import { buildEventIcs } from "@/lib/ics";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { bookingCopy, getPublicBooking } from "@/server/agenda/public-view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 015 — Descarga pública del .ics de UNA cita, para que el prospecto la
 * guarde en su propio calendario y no se le olvide asistir.
 *
 * Sin sesión a propósito: este enlace va por WhatsApp a alguien que nunca
 * entra al CRM. La "credencial" es el propio id de la cita (nanoid de 20
 * caracteres, igual de impredecible que un token) — mismo patrón que un
 * enlace de Calendly o de Zoom. No expone nada que el mensaje de WhatsApp no
 * le haya dicho ya al prospecto.
 */
export async function GET(_req: Request, ctx: Params) {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const { id } = await ctx.params;

  const booking = await getPublicBooking(id);
  if (!booking) return new Response(null, { status: 404 });

  const { title, description } = bookingCopy(booking);
  const cancelled = booking.status === "cancelada";

  const ics = buildEventIcs({
    uid: `${booking.id}@vocero`,
    startUtc: booking.scheduledAt.toISOString(),
    durationMinutes: booking.durationMinutes,
    summary: cancelled ? `Cancelada: ${title}` : title,
    description: description || undefined,
    location: booking.meetingLink || booking.connectorLabel,
    organizerName: booking.orgName || undefined,
    status: cancelled ? "CANCELLED" : "CONFIRMED",
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="cita.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
