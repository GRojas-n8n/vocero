# Guion E2E — Los hechos de la IA no se fusionan ni duplican

> Automatizado en `scripts/e2e-selftest.mjs` (sección "Auditoría 2026-09-17:
> hechos de la IA no se fusionan ni duplican", contra `pnpm dev` con wa-mock +
> ai-mock + Postgres real). Nace de un incidente real: el contacto GRojas
> (Más Impulso) probó tres negocios distintos con el mismo teléfono y
> `update_lead` dejó diez párrafos `[IA]` acumulativos en `contact.notes`,
> mezclando giros incompatibles y presentando inferencias como hechos.

## El fallo original

`appendLeadNote` (pipeline.ts) concatenaba `[IA] {nota}` sin fin al campo de
texto libre `contact.notes` en cada turno: sin deduplicación, sin origen, sin
estado de confirmación, y sin ninguna noción de que "plomería" y "clínica
dental" no pueden ser el mismo lead. El mismo campo lo edita el dueño a mano,
así que un turno del agente podía convertir una corrección manual en un
párrafo más de la pila.

## Rediseño (`server/contacts/notes.ts`)

- El agente YA NO escribe en `contact.notes` — ese campo es 100% del dueño.
- Cada hallazgo es una fila atómica en `contact_note`: un hecho, un origen
  (`sourceMessageId`), un estado (`confirmed | test | conflict`) y, si el
  turno lo declaró, un `scenario` (giro/tema breve).
- Deduplicación real por hash del texto normalizado (`contentHash`, UNIQUE
  por contacto): un reintento o una ráfaga agrupada por el coalesce nunca
  duplica el mismo hecho.
- `status`: `test` si la conversación es del Laboratorio; `conflict` si el
  `scenario` declarado no coincide con el último `scenario` `confirmed` del
  mismo contacto (alguien probando otro negocio con el mismo teléfono) —
  nunca se fusiona bajo `confirmed`. Ninguna fila cambia de estado después de
  creada: corregir es que un mensaje posterior escriba una fila nueva.

## Camino verificado

1. Un contacto real dice "giro: plomería. Quiere cotización de tinacos".
   ✅ Se crea UN hallazgo `confirmed` con `scenario: "plomería"`.
   ✅ `contact.notes` (el campo del dueño) sigue vacío — el agente no lo tocó.
2. Llega el MISMO hecho otra vez (reintento/ráfaga, `wa_message_id` distinto).
   ✅ Sigue habiendo un solo hallazgo — no se duplicó.
3. El mismo contacto, ahora "giro: clínica dental. Pregunta por limpieza".
   ✅ Se guarda como `conflict` (giro distinto al ya confirmado).
   ✅ El hallazgo de plomería original SIGUE `confirmed` — no se reinterpretó.
   ✅ En total quedan 2 hallazgos (el duplicado del paso 2 no cuenta).

## Lo que este guion NO cubre (y por qué)

- El estado `test` (conversación del Laboratorio) está cubierto por unit test
  (`tests/unit/contact-notes.test.ts`), no aquí: exigiría levantar el flujo
  completo de `/api/lab/runs` solo para una rama que ya es determinística por
  `conversation.is_test`.
- El avance automático de etapa al agendar una cita (spec 015, FR-011) se
  deja intacto a propósito — es una función auditada y decidida, no el bug de
  este incidente (en el caso real, la etapa nunca se movió).
