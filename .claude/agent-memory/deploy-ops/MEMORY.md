<!--
Índice de memoria del subagente deploy-ops (memoria de proyecto, versionada).
Una línea por memoria: - [Título](archivo.md) — gancho de una línea.
Vacío al inicio; el subagente lo irá poblando (IDs de la plataforma, modos de
fallo recurrentes del deploy, comando de migración, healthcheck, etc.).
-->

- [Ruta A: deploy por webhook de Coolify](ruta-a-coolify-webhook.md) — sin MCP ni SSH desde este checkout, deploy/logs/estado se gestionan vía webhook + dashboard; dominio `crm.masimpulsodigital.com`.
- [Seed de MÁS Impulso Digital en producción](mas-impulso-seed-produccion.md) — correr `node seed-mas-impulso.mjs <org_id>` dentro del contenedor, nunca desde dev.
- [/api/health expone el commit](health-expone-commit.md) — `curl` público basta para comparar commit desplegado vs. HEAD local, sin Coolify.
