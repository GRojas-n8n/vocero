# E2E — Cotizaciones (019)

Guion de comportamiento observable. Automatizado en la sección `019` de
`scripts/e2e-selftest.mjs`: con la app viva y los mocks encendidos,
`pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación**: app en `localhost` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `BOT_API_KEY` y la BD migrada
(`0013_glamorous_eternity.sql` aplicada). La bandera `QUOTES` decide qué mitad
del guion corre: ambas se ejercitan en la matriz de CI.

Para que se ejerciten también los checks del webhook (US4), apunta
`QUOTES_N8N_WEBHOOK_URL` al receptor de prueba que ya vive en este repo —
`http://localhost:3000/api/dev/n8n-mock/inbox` (mismo puerto que
`APP_BASE_URL`, gateado por el mismo `WA_MOCK_ENABLED`) — y opcionalmente
`QUOTES_N8N_WEBHOOK_SECRET` para que también se verifique la firma HMAC. Sin
la URL configurada, esa sección se omite con una nota en la consola; el resto
del guion corre igual.

---

## US1 — La instancia decide si el módulo existe

Con `QUOTES` ausente:

1. `GET /api/quotes`, `POST /api/quotes`, `GET/PATCH/DELETE /api/quotes/[id]`
   responden **404**.
2. La pantalla `/quotes` responde 404.
3. La navegación no menciona "Cotizaciones" y la tarjeta del lead en el
   pipeline no tiene el atajo (ícono de documento).

Con `QUOTES=on`, las mismas rutas responden con normalidad y el ícono aparece
en cada tarjeta del pipeline.

## US2 — Crear y editar un borrador

1. Desde una tarjeta del pipeline, el atajo lleva a `/quotes?leadId=<id>`.
2. `POST /api/quotes` con al menos un renglón crea la cotización en estado
   `borrador` y responde **201**; sin renglones, **422**.
3. Los totales (`subtotalCents`, `totalCents`) se calculan en el servidor —
   nunca se confía un total mandado por el cliente.
4. `PATCH /api/quotes/[id]` con `{action:"update", ...}` reemplaza renglones,
   notas, descuento o vencimiento **mientras sea borrador**; sobre una
   cotización ya enviada responde **409** (`locked`).
5. `DELETE /api/quotes/[id]` borra un borrador; sobre una ya enviada, 409.

## US3 — La máquina de estados

1. `borrador → enviada` (`action:"send"`) exige al menos un renglón y guarda
   `sentAt`.
2. `enviada → aceptada` (`action:"accept"`) y `enviada → rechazada`
   (`action:"reject"`) guardan `respondedAt`.
3. Cualquier transición fuera de esas (p. ej. `borrador → aceptada`, o repetir
   `send` sobre algo ya enviado) responde **422**.
4. Una `enviada` cuyo `validUntil` ya pasó se **muestra** como `vencida` en
   las lecturas (`displayStatus`), sin que el estado guardado cambie — sigue
   pudiendo aceptarse o rechazarse igual que cualquier `enviada`.

## US4 — El webhook hacia n8n es opcional y best-effort

1. Sin `QUOTES_N8N_WEBHOOK_URL`: enviar o aceptar una cotización sigue
   funcionando completo (200/200), y `quote.webhookStatus` queda `skipped`.
2. Con la URL configurada y el receptor arriba: al pasar a `enviada` o
   `aceptada`, el receptor recibe un POST con el body documentado en
   `src/server/quotes/webhook.ts` (`event`, `quote{...}`); si
   `QUOTES_N8N_WEBHOOK_SECRET` está definida, el header
   `x-vocero-signature` trae `sha256=<hmac del body>` verificable con esa
   clave. `quote.webhookStatus` queda `sent`.
3. Con el receptor caído o devolviendo error: la transición de estado se
   confirma igual (nunca se revierte por esto) y `quote.webhookStatus` queda
   `failed` con `webhookError` legible. La UI de `/quotes` lo señala con una
   insignia ("n8n no se enteró"), pero el flujo del operador no se bloquea.

## US5 — Multi-tenancy

Cada query de dominio pasa por `scoped()` (`src/lib/db/tenant.ts`), que exige
`organizationId` explícito — igual que el resto del CRM. `queries.ts` y
`service.ts` de cotizaciones lo usan en cada lectura/escritura. El contrato de
`scoped()` está probado en `tests/unit/tenant.test.ts`; **no** se ejercita con
una segunda organización aquí porque el registro público se cierra tras la
primera (`ALLOW_SIGNUP`), variable que ninguna otra sección de este arnés
necesita.
