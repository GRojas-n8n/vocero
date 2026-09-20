# Contrato: Acciones del agente y juez del Laboratorio

## Adaptador LLM (frontera única)

`lib/ai`: cliente `fetch` OpenRouter-compatible. Env: `OPENROUTER_API_TOKEN` (opcional —
sin él, agente/Laboratorio deshabilitados con estado vacío), `OPENROUTER_BASE_URL`
(default `https://openrouter.ai/api`), `OPENROUTER_MODEL`, `OPENROUTER_JUDGE_MODEL`
(default = `OPENROUTER_MODEL`). API: `chatJson<T>(schema, messages, opts)` → parsea con
extracción robusta (bloque ```json, primer `{...}`), valida con Zod. **Actualizado por
[023](../../023-respuesta-estructurada-agente/spec.md)**: pide JSON con `response_format`
(`json_schema` estricto → `json_object` → sin formato, según `AI_RESPONSE_FORMAT`), el
esquema JSON se deriva del Zod, y los reintentos dependen de la CLASE de error (429
respeta `Retry-After`; 5xx/red ≤ 2; timeout ≤ 1; formato/esquema ≤ 1 corrección; 4xx
determinista 0). **Presupuesto compartido por turno: ≤ 3 llamadas** (reintentos, bajada de
formato, corrección y recuperación de texto plano descuentan del mismo `CallBudget`); sólo
formato ≤ 2. Sólo un rechazo EXPLÍCITO del proveedor (`param`/`code` estructurados o la
frase de OpenRouter para `require_parameters`) baja de `response_format`; un 400/404/422
genérico es `invalid_request`. Un hipo del proveedor NUNCA propaga excepción al turno: el
resultado `error` lleva un código explícito (`not_configured`, `unauthorized`,
`unsupported_response_format`, `schema_rejected`, `model_not_found`, `invalid_request`,
`rate_limited`, `timeout`, `network_error`, `provider_error`, `invalid_json`,
`invalid_schema`) y un `detail` fijo, sin contenido del cliente ni del modelo. El modelo
efectivo sale de `resolveEffectiveModel` (`GET /api/settings/ai` → `effective`).

## Acción del agente (una por turno)

```ts
const AgentAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('none') }),
  z.object({ action: z.literal('reply'), text: z.string().min(1) }),
  z.object({ action: z.literal('update_lead'), note: z.string().trim().min(1).max(300),
             scenario: z.string().trim().min(1).max(80).optional(),
             reply: z.string().optional() }),
  z.object({ action: z.literal('move_stage'), stage: z.string().min(1),
             reply: z.string().optional() }),
  z.object({ action: z.literal('handoff'), reason: z.string().optional(),
             farewell: z.string().optional() }),
])
```

- `move_stage.stage` se resuelve contra nombres de etapas de la org (fuzzy exacto →
  lower-case); sin match → se degrada a `reply` si trae texto, o `none`.
- Auditoría 2026-09-17 (incidente GRojas/Más Impulso) — `update_lead` ya NO escribe en
  `contact.notes` (ese campo es 100% del dueño). Cada nota es UN hecho atómico y va a
  `contact_note` (`server/contacts/notes.ts`, `recordAiNote`), deduplicado por hash y con
  estado `confirmed | test | conflict`: `test` si `conversation.is_test`; `conflict` si
  `scenario` no coincide con el último `scenario` `confirmed` del mismo contacto (giro de
  negocio incompatible con el mismo teléfono — nunca se fusiona bajo `confirmed`). Ninguna
  fila cambia de estado después de creada.
- Regex de respaldo de handoff (se evalúa sobre el mensaje del cliente ANTES del LLM):
  `/(hablar|comunicar|contactar)[\s\S]{0,40}?(asesor|humano|persona|alguien)|un asesor|atenci[oó]n humana/i`
  — "somos 4 personas" NO matchea (unit test).
- Disparadores de turno: ingesta de mensaje entrante en conversación con IA activa
  (global + conversación + sin handoff). Debounce (coalesce) 6s producción / 0 en
  Laboratorio; lock in-process por `conversation_id`; los mensajes que llegan durante el
  turno se re-encolan.
- Ventana cerrada → handoff automático `ventana`. Fallo persistente del proveedor o de
  configuración (transporte/config) → handoff `error`, sin enviar texto libre. Un fallo de
  **formato** (texto plano, JSON inválido) NO es un fallo del proveedor: el texto plano
  seguro se recupera como `reply` (023 §3.4), y si no, se envía un mensaje fijo de
  degradación (`AI_FALLBACK_MESSAGE`) con la IA activa; dos turnos consecutivos así
  (`conversation.ai_fail_count ≥ 2`, contador técnico atómico en la base, independiente del
  texto visible) → handoff `error`. El texto plano JAMÁS ejecuta una acción con efectos.
- Circuito de protección por organización+modelo: con una falla global (config o
  transporte agotado, ≥ 2 conversaciones distintas) los turnos no llaman al proveedor ni
  hacen handoff; la IA sigue activa y el cliente recibe una vez el mensaje fijo (sin
  prometer un humano). Señal: logs `circuit_open|blocked|closed` sin contenido.

## Juez del Laboratorio (una llamada por conversación)

Input: transcript completo + KB + comportamiento. Output (Zod):

```ts
const Verdict = z.object({
  veredicto: z.enum(['verde', 'amarillo', 'rojo']),
  hallazgos: z.array(z.object({
    tipo: z.enum(['alucinacion', 'fuera_de_kb', 'debio_escalar', 'tono']),
    evidencia: z.string(),
    sugerencia: z.object({ pregunta: z.string(), respuesta: z.string() }).optional(),
  })),
})
```

Juez inválido tras reintentos → caso `judge_failed` (excluido del score, visible en el
reporte); la corrida continúa.

## Personas guionadas (fijas, sin LLM)

6 claves: `comprador_decidido`, `pregunton_precios`, `cliente_enojado`, `fuera_de_kb`,
`pide_humano`, `errores_modismos`. Cada una: 4–5 mensajes predefinidos; el runner envía
mensaje → espera el turno del agente (pipeline real, debounce 0) → siguiente. Fin del
guion o primer handoff → juez.
