import { appBaseUrl } from "@/lib/env";
import { computeAvailability } from "@/server/agenda/availability";
import { getSettings } from "@/server/agenda/settings";
import { pickAcrossDays, spreadByDay } from "@/server/agenda/spread";
import { replaceOffers } from "@/server/agenda/offers";
import { BookingError, createSessionBooking } from "@/server/agenda/service";

/**
 * 015 — Lo que el agente incluido puede hacer con la agenda.
 *
 * Vive aquí y no en el pipeline para que el pipeline no aprenda de agendas: el
 * turno pide "ofrece" o "reserva" y recibe el texto que hay que mandar.
 *
 * Regla que atraviesa las dos operaciones: el modelo NO redacta horarios. Pide
 * ofrecer, y el motor pega las etiquetas reales. Si el modelo inventa un
 * instante al reservar, el motor lo rechaza y se re-ofrece — nunca se agenda
 * algo que el cliente no eligió.
 */

/** Cuántos huecos se le enseñan al cliente en un mensaje. */
const SHOWN = 3;
/** Cuántos se guardan como reservables: el catálogo es más ancho que el menú. */
const OFFERED = 12;

export type AgendaTurn = {
  /** Lo que hay que enviarle al cliente. */
  text: string;
  /** false ⇒ el motor no pudo; el turno sigue, sin agendar. */
  ok: boolean;
};

export async function offerSlots(input: {
  organizationId: string;
  conversationId: string;
  intro?: string;
}): Promise<AgendaTurn> {
  const settings = await getSettings(input.organizationId);
  const now = new Date();
  const all = await computeAvailability(input.organizationId, {
    settings,
    now,
  });
  const spread = spreadByDay(all, {
    timezone: settings.timezone,
    limit: OFFERED,
    perDay: 3,
    now,
  });

  if (spread.length === 0) {
    // Agenda llena no es un error: es una respuesta que el cliente entiende.
    return {
      ok: false,
      text:
        input.intro?.trim() ||
        "Por ahora no me quedan horarios libres. Déjame confirmarlo con el equipo y te aviso.",
    };
  }

  // Se REGISTRA todo el catálogo, no solo lo que se enseña: si el cliente pide
  // otro día, el agente tiene alternativas legítimas que aceptar.
  await replaceOffers(
    input.organizationId,
    input.conversationId,
    spread.map((s) => ({ startUtc: s.startUtc, label: s.label }))
  );

  // `spread` ya viene agrupado por día en orden cronológico: tomar los
  // primeros SHOWN a secas mostraría solo el primer día si ese día por sí
  // solo llena el menú. `pickAcrossDays` reparte por variedad primero.
  const shown = pickAcrossDays(spread, SHOWN);
  const lista = shown.map((s) => `• ${s.dayLabel} a las ${s.time}`).join("\n");
  const intro = input.intro?.trim() || "Tengo estos horarios disponibles:";
  return { ok: true, text: `${intro}\n${lista}` };
}

export async function bookSlot(input: {
  organizationId: string;
  conversationId: string;
  startUtc: string;
  confirmation?: string;
  /** Fase 5 — motivo breve tomado de la conversación; ver actions.ts. */
  reason?: string;
}): Promise<AgendaTurn> {
  try {
    const result = await createSessionBooking({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      startUtc: input.startUtc,
      source: "ai",
      requireOffer: true,
      notes: input.reason?.trim() || null,
    });

    const base =
      input.confirmation?.trim() || `¡Listo! Te agendé para ${result.label}.`;
    // La página de confirmación se lee SIEMPRE en vivo desde la cita real
    // (public-view.ts): si el enlace de reunión llega después (linkPending) o
    // la cita se mueve o se cancela, quien abra este link ve el estado actual
    // — nunca datos de cuando se mandó el mensaje.
    const confirmationUrl = `${appBaseUrl()}/cita/${result.booking.id}`;
    const guardar = `Guárdala en tu calendario (Google, Outlook o .ics): ${confirmationUrl}`;
    if (result.meetingLink) {
      return {
        ok: true,
        text: `${base}\nEnlace: ${result.meetingLink}\n${guardar}`,
      };
    }
    if (result.linkPending) {
      // La cita existe; el enlace no. No se promete lo que no se tiene.
      return {
        ok: true,
        text: `${base}\nEn un momento te comparto el enlace por aquí.\n${guardar}`,
      };
    }
    return { ok: true, text: `${base}\n${guardar}` };
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;

    // Se ocupó o el modelo inventó la hora: en ambos casos se re-ofrece con
    // datos reales en vez de discutir con el cliente.
    if (err.slots.length > 0) {
      const lista = err.slots
        .slice(0, SHOWN)
        .map((s) => `• ${s.label}`)
        .join("\n");
      const disculpa =
        err.code === "slot_taken"
          ? "Se me acaba de ocupar ese horario, ¡perdón!"
          : "Déjame confirmarte los horarios que tengo:";
      return { ok: false, text: `${disculpa}\n${lista}` };
    }
    return {
      ok: false,
      text: "No pude agendarlo en este momento. Lo reviso con el equipo y te confirmo.",
    };
  }
}
