---
name: webhook-requiere-bearer-token
description: El POST a COOLIFY_DEPLOY_WEBHOOK_URL solo con la URL responde 401 Unauthenticated — Coolify exige además un header Authorization Bearer con un API token separado.
metadata:
  type: feedback
---

Probado 2026-09-12: `curl -X POST "$COOLIFY_DEPLOY_WEBHOOK_URL"` (URL guardada
en `.env` local, ver [[ruta-a-coolify-webhook]]) responde
`401 {"message":"Unauthenticated."}`. La URL del webhook por sí sola NO basta
— Coolify requiere un `Authorization: Bearer <token>` con un API token de
Coolify (distinto de la URL del webhook), que no vive en este checkout ni en
`.env` (correcto, según la decisión del dueño de no guardar accesos de la
plataforma aquí).

**Why:** Coolify separa la URL del webhook (identifica qué recurso
desplegar) del token de autenticación (autoriza la llamada). Guardar ambos en
el mismo lugar anularía la separación deliberada que el dueño quiso mantener
en [[ruta-a-coolify-webhook]].

**Cómo aplicar**: antes de intentar triggerear un deploy vía webhook, avisar
al dueño que además de la URL hace falta el Bearer token (o pedirle que
dispare el deploy manualmente desde el dashboard de Coolify). Si el dueño
comparte el token en el chat para una ejecución puntual, usarlo sin
guardarlo en ningún archivo ni en memoria.
