import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { CONNECTOR_META, type ConnectorId } from "@/lib/agenda-connectors";
import { getSettings } from "@/server/agenda/settings";

/**
 * 015 — Lo que la cita le muestra a un PROSPECTO, sin sesión: el .ics público
 * y la página de confirmación leen exactamente lo mismo, de aquí, para que
 * nunca diverjan en el título, la hora o el estado de la cita.
 *
 * Misma "credencial" que el .ics: el id de la cita (nanoid impredecible). No
 * expone nada que el mensaje de WhatsApp no le haya dicho ya al prospecto.
 */

export type PublicBooking = {
  id: string;
  status: "agendada" | "realizada" | "no_show" | "cancelada";
  scheduledAt: Date;
  durationMinutes: number;
  /** Para `SEQUENCE` del .ics — RFC 5545 §3.8.7.4, ver `lib/ics.ts`. */
  updatedAt: Date;
  meetingLink: string | null;
  linkPending: boolean;
  connectorLabel: string | undefined;
  timezone: string;
  orgName: string;
  contactName: string;
  /** Ya resuelto (`getSettings`): título de la invitación, nunca vacío. */
  appointmentTitle: string;
};

export async function getPublicBooking(
  bookingId: string
): Promise<PublicBooking | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.booking.id,
      organizationId: schema.booking.organizationId,
      status: schema.booking.status,
      scheduledAt: schema.booking.scheduledAt,
      durationMinutes: schema.booking.durationMinutes,
      updatedAt: schema.booking.updatedAt,
      meetingLink: schema.booking.meetingLink,
      linkPending: schema.booking.linkPending,
      connector: schema.booking.connector,
      contactId: schema.booking.contactId,
      kind: schema.booking.kind,
    })
    .from(schema.booking)
    .where(eq(schema.booking.id, bookingId))
    .limit(1);
  const booking = rows[0];
  // Un bloqueo manual (`kind: "block"`) no es una cita del prospecto: no
  // tiene contacto ni nada que confirmarle a nadie.
  if (!booking || booking.kind !== "session") return null;

  const [orgRows, contactRows, settings] = await Promise.all([
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
    getSettings(booking.organizationId),
  ]);

  return {
    id: booking.id,
    status: booking.status,
    scheduledAt: booking.scheduledAt,
    durationMinutes: booking.durationMinutes,
    updatedAt: booking.updatedAt,
    meetingLink: booking.meetingLink,
    linkPending: booking.linkPending,
    connectorLabel: booking.connector
      ? CONNECTOR_META[booking.connector as ConnectorId]?.label
      : undefined,
    timezone: settings.timezone,
    orgName: orgRows[0]?.name?.trim() || "",
    contactName: contactRows[0]?.name?.trim() || "",
    appointmentTitle: settings.appointmentTitle,
  };
}

/**
 * Título y descripción — el mismo texto para el .ics, los enlaces de
 * Google/Outlook y la página de confirmación.
 *
 * El título viene de `calendar_settings.appointment_title` (Ajustes →
 * Agenda), NUNCA del nombre de la organización: ese es un dato interno del
 * CRM (a veces un placeholder de setup) y no algo profesional para mostrarle
 * a un prospecto en SU calendario.
 */
export function bookingCopy(booking: PublicBooking): {
  title: string;
  description: string;
} {
  const title = booking.appointmentTitle;
  const descriptionLines = [
    booking.contactName ? `Cita de ${booking.contactName}.` : null,
    booking.meetingLink ? `Enlace: ${booking.meetingLink}` : null,
    booking.status === "cancelada" ? "Esta cita fue cancelada." : null,
  ].filter((l): l is string => Boolean(l));
  return { title, description: descriptionLines.join("\n") };
}
