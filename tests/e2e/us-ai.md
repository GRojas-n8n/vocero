# E2E — Token del proveedor de IA por organización (022)

Guion de comportamiento observable. Automatizado en la sección `022` de
`scripts/e2e-selftest.mjs`: con la app viva y los mocks encendidos,
`pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación**: app en `localhost` con `OPENROUTER_BASE_URL` → ai-mock y la
BD migrada. Sin fila guardada, la instancia sigue usando `OPENROUTER_*` del
entorno — esta pantalla es una anulación opcional, no un requisito.

---

## US1 — Guardar valida ANTES contra el proveedor

1. Un token que el proveedor rechaza responde **422** y **no se guarda**: la
   conexión sigue sin existir (`GET /api/settings/ai` → `connection: null`).
2. Un token válido se guarda junto con el modelo y el modelo del juez
   (opcional); hacia el navegador solo salen sus **últimos 4** — el token
   completo no aparece en ninguna respuesta.

## US2 — Probar sin guardar

`POST /api/settings/ai/test` con el body vacío reusa el token y el modelo ya
guardados — así se puede verificar la conexión sin volver a pegar un secreto
que la pantalla nunca devolvió.

## US3 — Quitar vuelve a las variables de entorno

`DELETE /api/settings/ai` borra la fila; a partir de ahí el agente y el juez
del Laboratorio vuelven a usar `OPENROUTER_API_TOKEN`/`OPENROUTER_MODEL` del
proceso, sin que la instancia deje de responder.

## US4 — El agente y el juez usan la anulación cuando existe

Cubierto por `tests/unit/ai-adapter.test.ts` (chatJson acepta un token de
organización que pisa el de entorno) y `tests/unit/judge.test.ts`
(`judgeCase` resuelve la config de IA de la organización antes de llamar al
proveedor).
