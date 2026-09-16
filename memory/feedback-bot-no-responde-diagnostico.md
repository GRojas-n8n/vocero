---
name: feedback-bot-no-responde-diagnostico
description: Al diagnosticar "el bot respondió una vez y luego se calló", descartar primero el mix-up de probar con el CRM abierto antes de asumir un bug del agente/webhook
metadata:
  type: feedback
---

Cuando el dueño reporta "probé el bot por WhatsApp desde otro número, respondió
una vez y luego ya no respondió más", el pipeline del agente
([[proyecto-vocero-arquitectura]] — `src/server/ai/pipeline.ts`,
`src/server/inbox/ingest.ts`) casi nunca es la causa real. Caso confirmado
2026-09-16: el dueño tenía la Bandeja del CRM abierta en la computadora
mientras probaba desde el teléfono; dos mensajes que creía haber mandado por
WhatsApp en realidad se escribieron (sin darse cuenta) en el cuadro de texto
del hilo de la Bandeja. Eso los mandó de verdad por la API de WhatsApp como
mensaje del NEGOCIO (`direction: out`, `origin: operator`, con
`wa_message_id` real y `status: read`) — indistinguible a simple vista de una
burbuja de cliente, salvo por quedar del lado equivocado del hilo. El agente
no respondió porque nunca llegó un mensaje ENTRANTE nuevo: no había nada raro
que corregir en el código.

**Why:** solo tener el CRM abierto viendo la conversación no manda nada (es
solo lectura vía SSE); el riesgo aparece si el foco del teclado cae en el
compositor del hilo mientras se escribe "como si fuera el cliente" en otro
dispositivo. El síntoma (bot se calla tras la primera respuesta) es idéntico
al de un handoff silencioso o un fallo del proveedor LLM, así que es fácil
perder tiempo revisando el pipeline cuando la causa es de la prueba misma.

**Cómo aplicar:** antes de sospechar del agente/pipeline/webhook ante este
síntoma, pedir un dump de los últimos mensajes de esa conversación
(`direction`, `origin`, `wa_message_id`, `status`, `created_at`) vía `psql` en
el contenedor de Postgres de Coolify (no hay acceso a la BD de producción
desde este checkout — ver
`.claude/agent-memory/deploy-ops/ruta-a-coolify-webhook.md`). Si los mensajes
"sin respuesta" aparecen como `direction: out` con `origin: operator` y un
`wa_message_id` con status `sent`/`read`, es este mix-up, no un bug: se
mandaron de verdad desde la propia sesión del CRM (compositor de la Bandeja o,
si estuviera configurado, `/api/bot/messages` con `BOT_API_KEY`). Confirmar
pidiendo al dueño que reintente sin tener el CRM abierto/enfocado en la
computadora. Solo profundizar en `runAgentTurn`/`applyHandoff`/logs del
proveedor si el `direction` de esos mensajes es realmente `in`.
