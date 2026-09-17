import { appBaseUrl } from "@/lib/env";
import { BookingError, type BookingResult } from "@/server/agenda/service";

/**
 * 015 — La traducción entre el dominio y HTTP, en un solo sitio.
 *
 * Vive aquí y no dentro de los `route.ts` por dos razones: Next solo admite
 * handlers como exports de una ruta (así que no serían testeables), y porque
 * los códigos y la FORMA del error son contrato observable, no un detalle.
 *
 * Las dos lecciones que costaron caro en producción y que este módulo fija:
 *  - Crear responde **201**, no 200. Un cliente que validaba `=== 200` dejó a
 *    todos los leads sin agendar durante horas, y los mocks no lo vieron
 *    porque respondían 200.
 *  - El error va ANIDADO (`{"error":{"code":…}}`) con `slots` como HERMANO. Un
 *    mock con la forma plana escondió el camino de re-oferta durante semanas:
 *    todo 409 se leía como conflicto genérico y las alternativas nunca se
 *    ofrecían.
 */

export type BookingPayload = {
  bookingId: string;
  meetingLink: string | null;
  linkPending: boolean;
  label: string;
  /** .ics descargable para que el prospecto guarde la cita en su calendario. */
  calendarUrl: string;
  /**
   * Página pública con los datos reales de la cita y botones para
   * precargarla en Google Calendar / Outlook, además del .ics — pensada para
   * mandarse por WhatsApp en vez del .ics a secas. Campo ADITIVO: un cerebro
   * externo que ya integró `calendarUrl` sigue funcionando igual.
   */
  confirmationUrl: string;
};

export function bookingPayload(result: BookingResult): BookingPayload {
  return {
    bookingId: result.booking.id,
    meetingLink: result.meetingLink,
    /**
     * true ⇒ la cita EXISTE pero el proveedor aún no entregó el enlace.
     * Confirma la cita y di que el enlace llega luego; no prometas uno que no
     * tienes.
     */
    linkPending: result.linkPending,
    label: result.label,
    calendarUrl: `${appBaseUrl()}/api/agenda/bookings/${result.booking.id}/ics`,
    confirmationUrl: `${appBaseUrl()}/cita/${result.booking.id}`,
  };
}

export function bookingErrorStatus(code: BookingError["code"]): number {
  switch (code) {
    case "not_found":
      return 404;
    case "invalid":
      return 422;
    case "slot_taken":
    case "slot_not_offered":
    // Auditoría 2026-09-17 — mismo trato que los otros conflictos: el
    // recurso pedido no se puede crear TAL CUAL, y quien llama ya trae en el
    // cuerpo lo que necesita para decidir (la cita existente, o esperar).
    case "existing_booking":
    case "reschedule_pending":
      return 409;
  }
}

/** Traduce un `BookingError` al sobre estándar. Cualquier otro error se relanza. */
export function bookingErrorResponse(err: unknown): Response {
  if (!(err instanceof BookingError)) throw err;
  const code = err.code === "invalid" ? "invalid_body" : err.code;
  return Response.json(
    {
      error: { code, message: err.message },
      slots: err.slots,
      // Auditoría 2026-09-17 — la cita (o el pedido) que bloqueó la creación,
      // para que el cerebro externo la nombre en vez de responder en
      // genérico. `null` en cualquier otro código: campo aditivo.
      existing: err.existing,
    },
    { status: bookingErrorStatus(err.code) }
  );
}
