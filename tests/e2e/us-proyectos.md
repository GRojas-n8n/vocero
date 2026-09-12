# E2E — Proyectos e hitos (021)

Guion de comportamiento observable. Automatizado en la sección `021` de
`scripts/e2e-selftest.mjs`: con la app viva y los mocks encendidos,
`pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación**: app en `localhost` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `QUOTES=on` (la automatización nace de una
cotización aceptada) y la BD migrada (`0014_outstanding_pet_avengers.sql`
aplicada). La bandera `PROJECTS` decide qué mitad del guion corre: ambas se
ejercitan en la matriz de CI.

---

## US1 — La instancia decide si el módulo existe

Con `PROJECTS` ausente: `GET /api/projects`, `GET/PATCH /api/projects/[id]` y
`PATCH /api/projects/[id]/milestones/[milestoneId]` responden **404**, la
pantalla `/projects` responde 404, la navegación no menciona "Proyectos" y la
tarjeta del lead no tiene su atajo. Aceptar una cotización sigue funcionando
igual (200) — la automatización simplemente no corre.

Con `PROJECTS=on`, las mismas rutas responden con normalidad y el ícono
aparece en cada tarjeta del pipeline.

## US2 — Aceptar una cotización abre el proyecto, automático

1. Al pasar una cotización de `enviada` a `aceptada`
   (`PATCH /api/quotes/[id]` con `{action:"accept"}`), en la MISMA operación
   nace un `project` para ese trato: `leadId` y `quoteId` coinciden con los
   de la cotización, `budgetCents` = `quote.totalCents`, `currency` =
   `quote.currency`, y arranca en estado `planning`.
2. Trae exactamente 4 hitos, en este orden y con estos títulos, todos
   `pending`:
   1. Recopilación de accesos y materiales
   2. Desarrollo en entorno de Staging / Coolify
   3. Revisión y ajustes del cliente
   4. Lanzamiento en Producción
3. `GET /api/projects?leadId=<id>` lo lista; `GET /api/projects` (sin filtro)
   también lo incluye.

## US3 — Seguimiento del proyecto y sus hitos

1. `PATCH /api/projects/[id]` con `{status:"in_progress"}` (o `review`,
   `completed`, `paused`) actualiza el estado; un valor fuera del enum → 422.
2. `PATCH /api/projects/[id]/milestones/[milestoneId]` con
   `{status:"in_progress"}` y luego `{status:"completed"}` avanza ESE hito
   sin tocar los demás. Un `milestoneId` que no pertenece a ese proyecto (o a
   esta organización) → 404.

## US4 — Sin cotización aceptada, no hay proyecto

Un trato que nunca tuvo una cotización aceptada no tiene entrada en
`GET /api/projects?leadId=<id>` (lista vacía) — no hay alta manual: nace solo
del flujo de cotizaciones.
