---
name: feedback-dependabot-triage
description: Al revisar alertas de Dependabot, priorizar por exposición real (¿el código llega a usar el patrón vulnerable? ¿la dep corre en producción o solo en build/dev?), no por el severity crudo de GitHub
metadata:
  type: feedback
---

En la revisión de 2026-09 (21 alertas, 12 "high"), solo 2 tenían exposición
real en esta app: `drizzle-orm` (SQL injection vía `sql.identifier()`/`.as()`
dinámico — confirmado que el repo NO usa ese patrón, todo `orderBy`/columna es
estático, pero se corrigió igual por ser la dependencia central de BD) y
`sharp` (CVEs de libheif, pero el repo no usa `next/image` en ningún lado —
ver comentario en `favicon-card.tsx` — así que el binario nunca se invoca en
runtime: queda dormido, sin acción).

Las otras 19 eran `vite`/`esbuild`/`vitest`/`postcss`/`js-yaml`/
`browserslist` — todas dependencias de build-time o del test runner, nunca
expuestas por la app en producción (Next.js standalone no las embarca como
servicio corriendo). `vitest` 3→4 y el `vite` 5→6 que arrastra son bumps
mayores que ameritan su propio pase de verificación, no uno apurado junto a
un fix de seguridad de producción.

**Por qué**: el severity de GitHub es sobre la librería en abstracto, no
sobre si ESTE código la usa de forma explotable. Leer la descripción del
advisory (`gh api repos/OWNER/REPO/dependabot/alerts/N`) y grepear el patrón
vulnerable en `src/` antes de decidir qué tan urgente es cada bump.

**Cómo aplicar**: en la próxima revisión de Dependabot, repetir esta
clasificación (producción vs. build/dev-only) antes de tocar nada, y separar
los bumps mayores (breaking-change risk) de los parches directos.
