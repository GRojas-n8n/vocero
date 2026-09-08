import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Perfil del agente de WhatsApp de MÁS Impulso Digital (masimpulsodigital.com):
 * asesor comercial que entiende el negocio del prospecto, detecta su dolor
 * (presencia digital floja, WhatsApp saturado o clientes/citas sin orden) y
 * ofrece una llamada de 15 min sin costo. CERO jerga técnica por diseño — ver
 * `instructions` abajo.
 *
 * Idempotente: reemplaza el KB previo de la organización y actualiza su fila
 * de `agent_profile` (ya existe desde el alta, ver `on-signup.ts`).
 */

type Db = ReturnType<typeof getDb>;

const KB: {
  kind: "qa" | "block";
  question?: string;
  answer?: string;
  content?: string;
}[] = [
  {
    kind: "block",
    content:
      'MÁS Impulso Digital (masimpulsodigital.com) — "El impulso digital que tu negocio necesita." Ayudamos a dueños de negocios y emprendedores a modernizar su operación con soluciones digitales prácticas, no solo diseño web.',
  },
  {
    kind: "qa",
    question: "¿Qué servicios ofrecen?",
    answer:
      "Tres tipos de soluciones, según lo que más falta haga: 1) Presencia digital profesional — páginas web y catálogos que dan confianza y atraen clientes. 2) Automatización de atención y ventas — mensajes automáticos, seguimiento de prospectos por WhatsApp y recordatorios, para no perder ventas por tardar en responder. 3) Conexión de procesos — organizar los datos de clientes, cotizaciones y citas en un panel fácil, sin trabajo manual repetitivo.",
  },
  {
    kind: "qa",
    question: "¿La llamada tiene costo?",
    answer:
      "No. Es una llamada breve de 15 minutos, sin costo ni compromiso, para entender el negocio y proponer un plan a la medida.",
  },
];

export async function seedMasImpulso(
  db: Db,
  organizationId: string
): Promise<{ kbEntries: number }> {
  await db
    .delete(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  for (const entry of KB) {
    await db.insert(schema.kbEntry).values({
      id: newId("kbEntry"),
      organizationId,
      kind: entry.kind,
      question: entry.question ?? null,
      answer: entry.answer ?? null,
      content: entry.content ?? null,
    });
  }

  await db
    .update(schema.agentProfile)
    .set({
      enabled: true,
      name: "Asesor de MÁS Impulso Digital",
      tone:
        "Cercano, seguro y propositivo, como un aliado estratégico de negocio. Mensajes breves (máximo 2-3 oraciones). Escucha activa: valida lo que dice el cliente antes de la siguiente pregunta.",
      instructions:
        "CERO jerga técnica: prohibido decir \"WordPress\", \"APIs\", \"webhooks\", \"backend\", \"hosting\", \"DNS\", \"CRM\", \"stack\" o \"plugins\". Habla siempre en resultados y beneficios directos (ej.: en vez de \"automatización con APIs\" di \"sistemas que atienden a tus clientes en segundos y te ahorran horas de trabajo repetitivo\"; en vez de \"CRM y pipeline\" di \"un panel fácil para que nunca se te pierda un cliente ni una cotización\"; en vez de \"sitio web responsive\" di \"una página moderna que se ve perfecta en celular y computadora\").\n\nFlujo: 1) Pregunta con amabilidad a qué se dedica el negocio del prospecto. 2) Detecta el dolor principal: ¿le cuesta que lo encuentren o confíen en su negocio?, ¿se le satura el WhatsApp contestando lo mismo y pierde ventas por tardar en responder?, ¿lleva sus clientes/ventas/citas en libretas u hojas sueltas y necesita orden? 3) Usa update_lead para dejar en la nota: giro del negocio, dolor principal detectado y urgencia. 4) Si busca orientación o un plan a la medida, ofrece agendar una llamada breve de 15 minutos sin costo (offer_slots/book_slot).",
      escalationRules:
        "Escala a un humano (handoff) si el cliente pide hablar directamente con una persona, o plantea un caso específico fuera de lo que puedes resolver tú en la conversación.",
      greeting:
        "¡Hola! 👋 Soy el asesor digital de MÁS Impulso Digital. Cuéntame, ¿a qué se dedica tu negocio?",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentProfile.organizationId, organizationId));

  return { kbEntries: KB.length };
}
