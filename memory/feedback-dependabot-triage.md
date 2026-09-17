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

**Actualización 2026-09-17**: mismas 19 alertas (ningún número nuevo), pero
ya existían parches que el 2026-09-13 no había — se aplicaron:
- `esbuild` (dependencia DIRECTA, no transitiva: alerta #3) → bump normal
  0.24.2→0.25.0 en `package.json`. Verificado bundleando `scripts/seed/*.ts`
  con los mismos flags del script real.
- `nanoid`, `js-yaml`, `browserslist`+`baseline-browser-mapping`, `postcss`
  → `overrides` en `pnpm-workspace.yaml` (⚠️ NO en `package.json`: pnpm
  10+/11 movió `pnpm.overrides` ahí — con pnpm 11.5.0 pinneado en
  `packageManager`, ponerlo en `package.json` se ignora en silencio con un
  WARN, sin fallar). Cada override usa el selector `pkg@<versión>` +
  reemplazo con caret (`^4.3.2`, no `>=4.3.2`) para quedarse en la MISMA
  línea mayor — un `>=` sin techo saltó `js-yaml` a la 5.x transitiva de
  `@eslint/eslintrc` sin querer en el primer intento.
- `sharp` queda IGUAL a propósito (dormido, `next/image` no se usa).
- `vite`/`vitest` 3→4 siguen diferidos (bump mayor, pase aparte).

Verificado con `pnpm typecheck/lint/test` (496/496) y `pnpm build` completo
(el CSS de producción salió con tamaño normal, sin errores del pipeline de
postcss/tailwind pese a forzar la copia que trae embebida `next@15.5.25`).
Cierra 6 de las 19 alertas (4 altas, 2 medias) sin cambiar código de la app.

**Cierre 2026-09-17 (mismo día, pase aparte)** — el bump mayor que se había
diferido, ya con el resto resuelto y sin apuro: `vitest` 3.2.7→4.1.11 y
`vite` (antes solo transitivo) declarado como devDependency directa en
`^6.4.3` porque Vitest 4 lo exige como *peer*. Antes de tocarlo se leyó la
guía real de migración (`v4.vitest.dev/guide/migration`, no solo el
resumen): el cambio de mocking que suena más grave — "las arrow functions
truenan" — solo aplica a **clases mockeadas e instanciadas con `new`**, un
patrón que este repo no usa (todos los `vi.fn()` de los tests son funciones
planas); se confirmó además por grep que ninguna API renombrada/eliminada
(`maxThreads`, `poolOptions`, `deps.external`, `test(name, fn, options)`,
reporters custom, config de `coverage`) aparece en `vitest.config.ts` ni en
ningún test. Verificado con la suite completa sin tocar un solo test
(496/496 verdes) y `pnpm build` limpio.

**Estado final confirmado** (`gh api .../dependabot/alerts`, commit
`c3ca5f7`): de 19 alertas quedan **2, ambas `sharp`** (#10, #38) — dormido a
propósito, sin acción pendiente. Las 17 restantes pasaron a `fixed`. Efecto
secundario cosmético sin resolver: Vite 6 ahora imprime un warning (no
error, tests igual pasan) en `tests/unit/version.test.ts` por los `import()`
dinámicos de cache-busting (`?plat=${Date.now()}`) — no bloquea nada, se
dejó igual por ser un archivo ajeno a esta tarea.

**Hallazgo aparte, sin acción** (no es de las 19, Dependabot nunca lo
marcó): `esbuild@0.18.20` transitivo vía `drizzle-kit` → paquetes
`@esbuild-kit/*` (ya señalados `deprecated` por pnpm en cada install).
`drizzle-kit` es CLI de build-time, nunca corre en producción — vale la
pena revisarlo si Dependabot lo llega a marcar, no antes.

**Cierre total 2026-09-18** — las 2 de `sharp` (#10, #38) que se habían
dejado "sin acción" por creerlas imposibles de fijar sin forzar una versión
ajena: revisando de nuevo, `next@15.5.25` YA declara
`"sharp": "^0.34.3 || ^0.35.4"` en sus propias `optionalDependencies` — la
0.35.4 (última publicada, cierra ambas) no es una versión externa forzada,
es una que Next ya soporta; pnpm solo había quedado resuelto en la rama
0.34.x por ser la que ya estaba en el lockfile. Se agregó al mismo
`overrides` de `pnpm-workspace.yaml`. Verificado con
`pnpm typecheck/lint/test` (496/496) y `pnpm build` completo, sin errores
ni menciones de `sharp` (sigue sin invocarse en runtime: el fix es
preventivo, no corrige una explotación real). Commit `20576c0`.

**Lección de esta última vuelta**: "no se puede sin forzar una versión
ajena" es una suposición que hay que verificar contra el `optionalDependencies`/
`peerDependencies` REAL del paquete que trae la dependencia transitiva
(`npm view <paquete>@<versión> optionalDependencies`), no asumir por el
número de versión — un salto de 0.34→0.35 se ve "mayor" pero puede estar ya
contemplado río arriba.

**Estado final: 0 de las 21 alertas originales quedan abiertas**
(confirmado con `gh api repos/GRojas-n8n/vocero/dependabot/alerts` el
2026-09-18, longitud de `state=="open"` = 0). Triaje cerrado por completo.
Próxima revisión: solo si Dependabot abre alertas nuevas.

**Por qué**: el severity de GitHub es sobre la librería en abstracto, no
sobre si ESTE código la usa de forma explotable. Leer la descripción del
advisory (`gh api repos/OWNER/REPO/dependabot/alerts/N`) y grepear el patrón
vulnerable en `src/` antes de decidir qué tan urgente es cada bump.

**Cómo aplicar**: en la próxima revisión de Dependabot, repetir esta
clasificación (producción vs. build/dev-only) antes de tocar nada, y separar
los bumps mayores (breaking-change risk) de los parches directos. Para fijar
un transitivo vulnerable sin tocar el manifiesto del paquete que lo trae:
override en **`pnpm-workspace.yaml`** (no en `package.json` → con pnpm
10+/11 ese campo se ignora en silencio, solo WARN, nunca falla) usando el
selector `pkg@<versión-vulnerable>: "^versión-parchada"` — el caret evita
saltar a una línea mayor no pedida. Antes de un bump mayor de verdad
(`vitest`/`vite`, etc.), leer la guía de migración REAL del proyecto (no
solo un resumen) y grepear en `src/`/`tests/` los patrones que cambiaron,
en vez de asumir por el changelog en abstracto. Y antes de marcar algo
"imposible de fijar sin forzar una versión ajena" (como se hizo con `sharp`
el 2026-09-13), revisar el `optionalDependencies`/`peerDependencies` REAL
del paquete que trae la transitiva (`npm view <paquete>@<versión>
optionalDependencies`) — puede que la versión parchada ya esté contemplada
río arriba.
