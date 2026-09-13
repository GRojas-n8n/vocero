---
name: feedback-audit-before-build
description: Antes de construir una feature que el dueño reporta como "faltante", auditar a fondo el código y specs — puede estar ya hecha tras una bandera
metadata:
  type: feedback
---

En una auditoría funcional grande (2026-09, "puntos pendientes" de Citas/
Agenda/Resultados), 3 de 4 frentes reportados como huecos resultaron estar
YA construidos en código (spec `015-motor-agenda-universal`, 58/58 tareas) —
el único hueco real era que `AGENDA=off` en el deploy. Ver
[[project-mas-impulso-agenda-flag]].

**Por qué**: el dueño reporta lo que VE en la UI de una instancia con banderas
apagadas, no lo que existe en el repo. Construir de cero algo que ya existe
tras una bandera desperdicia esfuerzo y puede duplicar código.

**Cómo aplicar**: ante cualquier "falta X" o "hay que agregar Y", antes de
escribir código:
1. Buscar specs en `specs/` (spec.md + tasks.md — ver si las tareas ya están
   `[X]`).
2. Grep del código relevante (`src/server/...`, rutas en `src/app/...`).
3. Revisar `src/lib/flag.ts` / banderas específicas (`agendaEnabled()`, etc.)
   — un 404 en la instancia actual no significa que el código no exista.

Solo después de confirmar que falta de verdad, entrar a Plan/Execute. Esto
recortó el alcance real de una auditoría de "4 módulos grandes" a "2 métricas
nuevas + un fix de timezone + un fix de scroll + un date-picker".
