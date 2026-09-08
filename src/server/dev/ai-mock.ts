import { JUDGE_MARKER } from "@/server/ai/prompts";

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

export function aiMockCompletion(messages: InMessage[]): string {
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

  const text = lastUser.toLowerCase();

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

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${eco}`,
  });
}
