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

**Estado confirmado tras el fix** (commit `b3e4921`, verificado con
`gh api repos/GRojas-n8n/vocero/dependabot/alerts` el 2026-09-13): las
alertas #1 y #5 de `drizzle-orm` pasaron a `state: fixed`. Siguen `open` las
19 restantes, todas build/dev-only:

| Paquete | Alertas | Origen | Fix pendiente |
|---|---|---|---|
| `sharp` | #10, #38 | dormido (no hay `next/image`) | ninguno — no exploitable, no vale la pena forzar el override |
| `postcss` | #6, #19, #20, #25 | build CSS (tailwindcss/autoprefixer/next interno) | `postcss` directo 8.4→8.5 sube parte; el bundleado dentro de `next@15.5.25` (8.4.31) no se puede fijar sin `pnpm.overrides` |
| `nanoid` (3.x) | #27, #28 | transitivo vía `postcss` | se resuelve solo cuando postcss lo actualice río arriba |
| `js-yaml` | #26, #37 | `@eslint/eslintrc` (carga config de eslint) | espera a que `eslint`/`@eslint/eslintrc` lo suban |
| `browserslist` / `baseline-browser-mapping` | #29, #32 | `autoprefixer` | espera a `autoprefixer` |
| `vite` | #4, #8, #9 | dev server interno de `vitest` | atado al bump mayor de `vitest` |
| `vitest` / `@vitest/mocker` | #31, #33, #34 | test runner | requiere `vitest` 3→4 (major, pase aparte) |
| `esbuild` | #3 | build-time | atado a `vite`/`vitest` |

Ninguna de estas tiene un parche que se pueda tomar sola sin forzar
`pnpm.overrides` (riesgo de romper el build de `next`/`tailwindcss` sin
probarlo) o sin el bump mayor de `vitest`. Revisar de nuevo cuando
Dependabot abra un PR de `vitest` 4.x, o al planear esa migración aparte.

**Por qué**: el severity de GitHub es sobre la librería en abstracto, no
sobre si ESTE código la usa de forma explotable. Leer la descripción del
advisory (`gh api repos/OWNER/REPO/dependabot/alerts/N`) y grepear el patrón
vulnerable en `src/` antes de decidir qué tan urgente es cada bump.

**Cómo aplicar**: en la próxima revisión de Dependabot, repetir esta
clasificación (producción vs. build/dev-only) antes de tocar nada, y separar
los bumps mayores (breaking-change risk) de los parches directos.
