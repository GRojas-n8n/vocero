# E2E — Activos de cliente (020)

Guion de comportamiento observable. Automatizado en la sección `020` de
`scripts/e2e-selftest.mjs`: con la app viva y los mocks encendidos,
`pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación**: app en `localhost` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock y la BD migrada
(`0014_outstanding_pet_avengers.sql` aplicada). La bandera `ASSETS` decide qué
mitad del guion corre: ambas se ejercitan en la matriz de CI.

---

## US1 — La instancia decide si el módulo existe

Con `ASSETS` ausente, `GET/POST /api/assets`, `GET/PATCH/DELETE
/api/assets/[id]` y `GET /api/assets/[id]/secret` responden **404**. No hay
pantalla propia: el módulo vive como sección del cajón del trato
(`LeadDrawer`), así que "apagado" significa que esa sección no se renderiza —
eso se verifica por inspección de componente, no por HTTP.

Con `ASSETS=on`, las mismas rutas responden con normalidad.

## US2 — Alta y lectura nunca exponen el secreto en claro

1. `POST /api/assets` sin `leadId` válido → 404 (`not_found`, el trato no
   existe); sin `name` → 422.
2. Un activo con `secret` se guarda cifrado (`lib/crypto`, AES-256-GCM, mismo
   mecanismo que el token de WhatsApp). La respuesta de creación, el
   `GET /api/assets?leadId=` y el `GET /api/assets/[id]` SOLO traen
   `hasSecret: boolean` — el campo `secret` nunca viaja en esas respuestas.
3. Un activo sin `secret` tiene `hasSecret: false`.

## US3 — Revelar la clave es un endpoint aparte

1. `GET /api/assets/[id]/secret` es la ÚNICA ruta que descifra: devuelve
   `{ secret: "<texto plano>" }` exactamente igual al que se guardó, o
   `{ secret: null }` si el activo no tiene uno.
2. Auditablemente separado de "listar": pedir la lista no revela nada, pedir
   la clave sí — y son dos llamadas distintas.

## US4 — Editar sin tocar el secreto, o borrarlo, o reemplazarlo

1. `PATCH /api/assets/[id]` sin la clave `secret` en el body deja el secreto
   guardado intacto (`hasSecret` no cambia, y `GET .../secret` sigue
   devolviendo el mismo valor).
2. `PATCH` con `secret: null` lo borra (`hasSecret` pasa a `false`,
   `GET .../secret` devuelve `null`).
3. `PATCH` con `secret: "<nuevo>"` lo re-cifra (`GET .../secret` devuelve el
   nuevo valor, nunca el anterior).

## US5 — Borrar

`DELETE /api/assets/[id]` responde 200 y una lectura posterior de ese id
responde 404.
