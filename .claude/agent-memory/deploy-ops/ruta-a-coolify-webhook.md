---
name: ruta-a-coolify-webhook
description: Vocero para MÁS Impulso Digital despliega en Coolify (Ruta A) vía webhook de build, sin MCP de Coolify ni SSH desde este checkout — deploy-ops no puede triggerear deploys ni leer logs/contenedores desde aquí.
metadata:
  type: project
---

Decisión confirmada 2026-09-09 (dueño): esta instancia usa **Ruta A
(Coolify)**, pero deliberadamente SIN registrar el MCP de Coolify ni accesos
SSH root en este checkout de dev. El despliegue se gestiona así:

- **Build/deploy**: se dispara con un `POST` a la URL de webhook de build de
  Coolify, guardada como `COOLIFY_DEPLOY_WEBHOOK_URL`. El dueño la tiene; NO
  vive en este repo ni debe guardarse en memoria — es un secreto operativo de
  la plataforma, no una var de runtime de la app, así que tampoco va en
  `.env.example`.
- **Dominio público**: `crm.masimpulsodigital.com`.
- **Seed de producción**: ver [mas-impulso-seed-produccion](mas-impulso-seed-produccion.md)
  — se corre dentro del contenedor ya desplegado, nunca desde este checkout.

**Cómo aplicar**: deploy-ops NO tiene forma de triggerear un deploy, leer
logs de contenedor, ni verificar estado de servicio desde este checkout —
solo puede verificar `/api/health` por HTTPS público (sin credenciales) y
sugerir el `curl -X POST "$COOLIFY_DEPLOY_WEBHOOK_URL"` para que el DUEÑO lo
ejecute (o ejecutarlo en el momento si el dueño comparte la URL en el chat,
pero nunca guardarla en un archivo). Para logs/estado de contenedor, pedir al
dueño que los pegue desde el dashboard de Coolify — no asumir que esto
cambia sin que el dueño lo confirme de nuevo.
