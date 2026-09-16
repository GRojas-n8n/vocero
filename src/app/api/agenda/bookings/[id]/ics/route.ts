import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { buildEventIcs } from "@/lib/ics";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { CONNECTOR_META, type ConnectorId } from "@/lib/agenda-connectors";

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

  const db = getDb();
  const rows = await db
    .select({
      id: schema.booking.id,
      organizationId: schema.booking.organizationId,
      status: schema.booking.status,
      scheduledAt: schema.booking.scheduledAt,
      durationMinutes: schema.booking.durationMinutes,
      meetingLink: schema.booking.meetingLink,
      connector: schema.booking.connector,
      contactId: schema.booking.contactId,
    })
    .from(schema.booking)
    .where(eq(schema.booking.id, id))
    .limit(1);
  const booking = rows[0];
  if (!booking) return new Response(null, { status: 404 });

  const [orgRows, contactRows] = await Promise.all([
    db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, booking.organizationId))
      .limit(1),
    booking.contactId
      ? db
          .select({ name: schema.contact.name })
          .from(schema.contact)
          .where(eq(schema.contact.id, booking.contactId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const orgName = orgRows[0]?.name?.trim() || "";
  const contactName = contactRows[0]?.name?.trim() || "";

  const connectorLabel = booking.connector
    ? CONNECTOR_META[booking.connector as ConnectorId]?.label
    : undefined;
  const summary = orgName ? `Cita con ${orgName}` : "Cita agendada";
  const descriptionLines = [
    contactName ? `Cita de ${contactName}.` : null,
    booking.meetingLink ? `Enlace: ${booking.meetingLink}` : null,
    booking.status === "cancelada" ? "Esta cita fue cancelada." : null,
  ].filter((l): l is string => Boolean(l));

  const ics = buildEventIcs({
    uid: `${booking.id}@vocero`,
    startUtc: booking.scheduledAt.toISOString(),
    durationMinutes: booking.durationMinutes,
    summary:
      booking.status === "cancelada" ? `Cancelada: ${summary}` : summary,
    description: descriptionLines.join("\n") || undefined,
    location: booking.meetingLink || connectorLabel,
    organizerName: orgName || undefined,
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
