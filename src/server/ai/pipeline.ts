import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { moveLeadToStage as moveLeadThroughHistory } from "@/server/leads/stage-history";
import { getEnv } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { resolveAiConfig } from "@/server/ai/credentials";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import {
  agentActionSchema,
  degradeAction,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { agendaEnabled } from "@/server/agenda/flag";
import { bookSlot, offerSlots, recordRescheduleRequest } from "@/server/agenda/agent";
import { getOffers } from "@/server/agenda/offers";
import { awaitMediaJob } from "@/server/whatsapp/media";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

type HistoryRow = typeof schema.message.$inferSelect;

/** Descripción textual de un adjunto sin transcripción (bug: antes el turno
 * ni se enteraba de que había llegado algo — un cliente mandando SOLO notas
 * de voz nunca recibía respuesta). */
function mediaPlaceholder(
  kind: typeof schema.mediaAsset.$inferSelect["kind"]
): string {
  switch (kind) {
    case "audio":
      return "[nota de voz — sin transcripción disponible]";
    case "image":
      return "[imagen]";
    case "video":
      return "[video]";
    case "document":
      return "[documento]";
    case "sticker":
      return "[sticker]";
    case "location":
      return "[ubicación compartida]";
    case "contacts":
      return "[contacto compartido]";
  }
}

/**
 * Cuánto espera el turno, como máximo, a que termine la transcripción de una
 * nota de voz que llegó como último mensaje entrante ANTES de resignarse al
 * marcador "sin transcripción disponible". El coalesce (AGENT_COALESCE_MS,
 * 6-8 s) ya pasó cuando esto corre; descarga+transcripción reales casi
 * siempre tardan más que eso, así que sin esta espera el turno respondía
 * sistemáticamente antes de tiempo (bug 2026-09-16, Diego/MÁS Impulso: Max
 * decía "no pude escucharla" con audios perfectamente entendibles).
 */
const AUDIO_TRANSCRIBE_WAIT_MS = 20_000;

/** true si el asset de audio todavía no tiene un desenlace definitivo
 * (ni transcripción, ni fallo de transcripción, ni fallo de descarga). */
function audioStillPending(
  asset: typeof schema.mediaAsset.$inferSelect | undefined
): boolean {
  if (!asset) return false;
  if (asset.kind !== "audio") return false;
  if (asset.caption) return false;
  if (asset.transcribeError) return false;
  if (asset.fetchStatus === "failed") return false;
  return true;
}

/**
 * Si el último mensaje entrante es una nota de voz sin desenlace todavía,
 * espera (acotado) el job de descarga+transcripción registrado por la
 * ingesta (`scheduleMediaJob`) en vez de dejar que el turno responda de
 * inmediato con el marcador genérico. No lanza ni bloquea otras
 * conversaciones — solo retrasa ESTE turno, que ya tiene el lock del
 * coalesce.
 */
async function waitForAudioTranscription(
  conversationId: string,
  mediaAssetId: string
): Promise<void> {
  const db = getDb();
  const fetchAsset = async () => {
    const rows = await db
      .select()
      .from(schema.mediaAsset)
      .where(eq(schema.mediaAsset.id, mediaAssetId))
      .limit(1);
    return rows[0];
  };

  const before = await fetchAsset();
  if (!audioStillPending(before)) return;

  console.log(
    `[agente] esperando transcripción del audio ${mediaAssetId} antes de responder (conv ${conversationId})`
  );
  await awaitMediaJob(mediaAssetId, AUDIO_TRANSCRIBE_WAIT_MS);

  const after = await fetchAsset();
  if (audioStillPending(after)) {
    console.warn(
      `[agente] transcripción del audio ${mediaAssetId} no terminó en ${AUDIO_TRANSCRIBE_WAIT_MS}ms: respondo con el marcador genérico`
    );
  }
}

/**
 * Arma el historial para el LLM. Un mensaje sin `text` (adjunto) YA NO
 * desaparece del turno: entra con un marcador (o la transcripción, si 018 la
 * dejó en `media.caption`) para que el agente sepa que algo llegó en vez de
 * quedarse mudo.
 */
async function historyAsChatMessages(
  history: HistoryRow[]
): Promise<ChatMessage[]> {
  const mediaIds = history
    .map((m) => m.mediaAssetId)
    .filter((id): id is string => id !== null);
  const mediaById = new Map<string, typeof schema.mediaAsset.$inferSelect>();
  if (mediaIds.length > 0) {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.mediaAsset)
      .where(inArray(schema.mediaAsset.id, mediaIds));
    for (const row of rows) mediaById.set(row.id, row);
  }

  const out: ChatMessage[] = [];
  for (const m of history) {
    let content = m.text;
    if (!content && m.mediaAssetId) {
      const media = mediaById.get(m.mediaAssetId);
      if (media) content = media.caption || mediaPlaceholder(media.kind);
    }
    if (!content) continue;
    out.push({
      role: m.direction === "in" ? "user" : "assistant",
      content,
    });
  }
  return out;
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(
  conversationId: string,
  opts?: {
    /**
     * Fase 6 — comportamiento SIN GUARDAR a probar (vista previa de Ajustes
     * → Agente, vía el Laboratorio). Nunca se aplica a una conversación
     * real: si `conversation.isTest` es false, se ignora — un turno real
     * jamás corre con instrucciones que el operador no publicó.
     */
    profileOverride?: Partial<
      Pick<
        typeof schema.agentProfile.$inferSelect,
        "name" | "tone" | "instructions" | "escalationRules" | "greeting"
      >
    >;
  }
): Promise<void> {
  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  let profile = profileRows[0];
  if (!profile) return;
  if (conversation.isTest && opts?.profileOverride) {
    profile = { ...profile, ...opts.profileOverride };
  }
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return;

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  if (lastInbound.type === "audio" && lastInbound.mediaAssetId) {
    await waitForAudioTranscription(conversationId, lastInbound.mediaAssetId);
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const agenda = agendaEnabled();
  // Sin esto el modelo solo conoce la etiqueta humana ("mié 16 sep, 09:00")
  // que él mismo mandó al cliente, y tiene que ADIVINAR el instante UTC exacto
  // para book_slot — findOffered exige el epoch exacto (sin tolerancia, a
  // propósito), así que sin la lista real el agendado nunca cierra.
  const offers = agenda ? await getOffers(organizationId, conversationId) : [];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({ profile, kb, stages, agenda, offers }),
    },
    ...(await historyAsChatMessages(history)),
  ];

  const aiConfig = await resolveAiConfig(organizationId);
  const result = await chatJson(agentActionSchema(agenda), messages, aiConfig);
  if (!result.ok) {
    if (result.error === "not_configured") return;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    await applyHandoff(conversationId, organizationId, "error");
    return;
  }

  let action: AgentActionType = result.data;

  // 015 — Agenda. Un fallo del motor degrada el turno (el agente responde sin
  // agendar), nunca lo tumba: quedarse callado es peor que no agendar.
  if (action.action === "offer_slots" || action.action === "book_slot") {
    if (!agenda) {
      action = degradeAction(action);
    } else {
      try {
        const turn =
          action.action === "offer_slots"
            ? await offerSlots({
                organizationId,
                conversationId,
                intro: action.reply,
              })
            : await bookSlot({
                organizationId,
                conversationId,
                startUtc: action.startUtc,
                confirmation: action.reply,
                reason: action.reason,
                confirmAdditional: action.confirmAdditional,
              });
        await deliverReply(conversation, turn.text);
        if (turn.ok) {
          publish(organizationId, {
            type: "conversation.updated",
            data: { conversation: { id: conversationId } },
          });
        }
        return;
      } catch (err) {
        console.error(`[agente] el motor de agenda falló: ${err}`);
        action = degradeAction(action);
      }
    }
  }

  // Auditoría 2026-09-17 — el agente incluido no tiene una herramienta de
  // reprogramación segura (mover la cita ATÓMICAMENTE requiere saber a cuál
  // instante moverla y el modelo no elige eso aquí): se registra el pedido
  // como estado persistente y se deriva SIEMPRE a un humano. El traspaso se
  // aplica pase lo que pase con la persistencia — mismo criterio que el
  // "handoff" de abajo: nunca dejar al agente agendando por su cuenta sobre
  // una cita que el cliente pidió mover.
  if (action.action === "request_reschedule") {
    if (!agenda) {
      action = degradeAction(action);
    } else {
      const turn = await recordRescheduleRequest({
        organizationId,
        conversationId,
        contactId: conversation.contactId,
        note: action.note,
      });
      await applyHandoff(conversationId, organizationId, "reprogramacion");
      try {
        await deliverReply(conversation, action.reply?.trim() || turn.text);
      } catch (err) {
        console.error(
          `[agente] traspaso por reprogramación aplicado pero el aviso no se pudo enviar: ${err}`
        );
      }
      return;
    }
  }

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply);
      return;
    }
    case "handoff": {
      // El traspaso se PERSISTE antes de intentar la despedida (bug
      // reportado: si el envío fallaba después de que Meta ya había
      // aceptado el mensaje, la excepción se comía el applyHandoff de abajo
      // y el prospecto se quedaba "avisado" sin que el panel de Resultados ni
      // el estado de la conversación registraran el traspaso). Con el orden
      // invertido, el peor caso pasa a ser "se aplicó el traspaso pero la
      // despedida no salió" — nunca al revés.
      await applyHandoff(conversationId, organizationId, "modelo");
      if (action.farewell) {
        try {
          await deliverReply(conversation, action.farewell);
        } catch (err) {
          console.error(
            `[agente] traspaso aplicado pero la despedida no se pudo enviar: ${err}`
          );
        }
      }
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana" | "reprogramacion"
): Promise<void> {
  const db = getDb();
  // Idempotente a propósito (WHERE handoff_at IS NULL): un segundo intento de
  // traspaso sobre la MISMA conversación (p. ej. la despedida del handoff de
  // arriba falla por ventana cerrada y `deliverReply` dispara su propio
  // applyHandoff("ventana")) no debe pisar el motivo real ya registrado.
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        isNull(schema.conversation.handoffAt)
      )
    )
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const leadId = rows[0]?.id;
  if (!leadId) return;

  // Por la puerta única: el agente mueve tarjetas igual que el dueño, y su
  // movimiento tiene que quedar en la bitácora o el embudo mentirá sobre
  // quién hizo avanzar cada lead.
  await moveLeadThroughHistory({
    organizationId,
    leadId,
    toStageId: stageId,
    source: "bot",
    extra: { lastActivityAt: new Date() },
    // El agente no clasifica pérdidas: si su etapa destino resultara ser la
    // perdida, la puerta lo rechaza y el lead se queda donde está — mejor eso
    // que un motivo inventado.
  });
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(eq(schema.contact.id, contact.id));
}
