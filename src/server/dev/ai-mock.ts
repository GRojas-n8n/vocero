import { JUDGE_MARKER } from "@/server/ai/prompts";
import { RECOVERY_MARKER } from "@/server/ai/recovery";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type ContentPart = { type?: string; text?: string };
type InMessage = { role: string; content: unknown };

/** 018: el contenido puede ser un string o partes multimodales (texto+audio). */
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as ContentPart[])
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

function isTranscriptionRequest(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    (content as ContentPart[]).some((p) => p.type === "input_audio")
  );
}

/** Prefijo del mensaje de corrección por esquema que arma `lib/ai` (spec 023). */
const CORRECTION_PREFIX = "Tu respuesta anterior es JSON pero no cumple el esquema";

const globalForMock = globalThis as unknown as { __aiMockCalls?: number };

/** 023: contador de llamadas recibidas (evidencia del self-test: "no hay 3 cargos"). */
export function aiMockStats(): { calls: number } {
  return { calls: globalForMock.__aiMockCalls ?? 0 };
}
export function resetAiMockStats(): void {
  globalForMock.__aiMockCalls = 0;
}

export function aiMockCompletion(messages: InMessage[]): string {
  globalForMock.__aiMockCalls = (globalForMock.__aiMockCalls ?? 0) + 1;
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  // 018: transcripción de audio — determinista, sin decodificar el audio real.
  if (lastUserMsg && isTranscriptionRequest(lastUserMsg.content)) {
    return JSON.stringify({ text: "transcripción de prueba de la nota de voz" });
  }

  const system = flattenContent(
    messages.find((m) => m.role === "system")?.content ?? ""
  );
  const lastUser = flattenContent(lastUserMsg?.content ?? "");

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre garantías/devoluciones (sugerencia aplicada).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  // 023 — Recuperación de texto plano: el verificador devuelve el borrador
  // tal cual (como lo haría un modelo obediente), para que el self-test pueda
  // recorrer el camino completo.
  if (system.includes(RECOVERY_MARKER)) {
    const draft = lastUser.match(/<borrador>\n([\s\S]*)\n<\/borrador>/)?.[1];
    return JSON.stringify(
      draft ? { action: "reply", text: draft } : { action: "none" }
    );
  }

  // 023 — Disparadores deterministas de salida defectuosa del modelo. La
  // llamada correctiva por esquema llega con un mensaje de `user` que empieza
  // por CORRECTION_PREFIX: el disparador se busca en el mensaje anterior.
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map((m) => flattenContent(m.content));
  const isCorrection = lastUser.startsWith(CORRECTION_PREFIX);
  const trigger = (isCorrection ? userTexts.at(-2) : lastUser) ?? "";
  // Incidente 2026-09: pregunta fuera de alcance → respuesta correcta pero en
  // TEXTO PLANO, sin JSON.
  if (/^prueba:texto-plano\b/i.test(trigger)) {
    return "Solo me enfoco en temas de CRM. Si quieres, seguimos con la demostración.";
  }
  // JSON válido pero con una acción que el esquema no admite: ni el intento
  // principal ni la corrección lo arreglan → formato irrecuperable.
  if (/^prueba:formato-invalido\b/i.test(trigger)) {
    return JSON.stringify({ action: "book_slot" });
  }

  const text = lastUser.toLowerCase();

  // Auditoría 2026-09-17 (incidente GRojas/Más Impulso) — marcador
  // determinista para ejercitar update_lead/recordAiNote de punta a punta en
  // el self-test (contrato ai.md). Formato del mensaje de prueba:
  // "giro: <giro>. <hecho>" — nunca aparece en una conversación real, así
  // que no compite con ningún otro disparador de abajo.
  const giroMatch = lastUser.match(/^giro:\s*([^.]+)\.\s*(.+)$/i);
  if (giroMatch) {
    return JSON.stringify({
      action: "update_lead",
      scenario: giroMatch[1]!.trim(),
      note: giroMatch[2]!.trim(),
      reply: "Anotado, gracias por la información.",
    });
  }

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  // Intención de compra → mover a Interesado.
  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      action: "move_stage",
      stage: "Interesado",
      reply: "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
    });
  }

  // Auditoría 2026-09-17 — pedir MOVER una cita existente nunca debe caer en
  // el camino de offer_slots/book_slot (ambos coinciden con "cita"/"agendar"
  // más abajo): se revisa primero y determinista.
  if (/\bmover\b|reprogramar|cambiar (mi|la|de) (cita|horario)/.test(text)) {
    return JSON.stringify({
      action: "request_reschedule",
      note: lastUser.slice(0, 120),
      reply: "Voy a confirmar el cambio con el equipo y te aviso por aquí.",
    });
  }

  // 015 — Agenda: dispara el mismo camino que un lead real, para poder
  // probar de punta a punta lo que ve el prospecto (no solo /api/bot/*, que
  // ya trae su propio catálogo — esto ejercita `offerSlots`/`bookSlot`, el
  // código que arma el MENSAJE de WhatsApp).
  //
  // Los horarios vigentes viajan en el system prompt como
  // `- <etiqueta> → startUtc: "<iso>"` (ver `buildAgentSystemPrompt`); si ya
  // hay alguno y el cliente suena a que está aceptando uno, agenda el
  // PRIMERO — determinista, para que el self-test sepa cuál pedir de vuelta.
  const offeredStarts = [...system.matchAll(/→ startUtc: "([^"]+)"/g)].map(
    (m) => m[1]!
  );
  if (
    offeredStarts.length > 0 &&
    /confirmo|acepto|ese (día|horario)|esa hora|el primero|me sirve|s[ií],? agenda|agendamos|res[ée]rvame|ap[uú]ntame/.test(
      text
    )
  ) {
    return JSON.stringify({
      action: "book_slot",
      startUtc: offeredStarts[0],
      reply: "¡Perfecto! Te confirmo tu cita.",
    });
  }
  if (/agendar|\bcita\b|horario/.test(text)) {
    return JSON.stringify({
      action: "offer_slots",
      reply: "Claro, aquí tienes algunos horarios disponibles:",
    });
  }

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${eco}`,
  });
}
