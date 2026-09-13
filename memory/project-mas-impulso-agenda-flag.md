---
name: project-mas-impulso-agenda-flag
description: Esta instancia es para el cliente MÁS Impulso Digital; el módulo de Citas/Agenda (015) ya está completo en código pero apagado por AGENDA=off
metadata:
  type: project
---

Esta instancia de Vocero se está personalizando para **MÁS Impulso Digital**
(masimpulsodigital.com) — ver `src/server/seed/mas-impulso.ts` (KB del agente
"Max"). El dueño la reporta en la auditoría funcional como "el CRM de MÁS
Impulso Digital".

El módulo de Citas/Agenda (spec `015-motor-agenda-universal`, 58/58 tareas)
está **100% construido**: ruta `/bookings` ("Citas"), item de nav, control de
estados (agendada/realizada/no_show/cancelada + reprogramar), bloque de
bloqueo de horario, `Ajustes → Agenda` completo (horario semanal, duración,
respiro, aviso mínimo, zona horaria, conectores Zoom/Google Calendar+Meet/
enlace fijo con credenciales cifradas y botón "Probar"), y preview de
"Próximos huecos". Verificado en vivo con Playwright en 2026-09 (ver sesión
que agregó `[[feedback-audit-before-build]]`).

**Por qué no se ve**: `AGENDA=off` en `.env` (local) — es una bandera de
DESPLIEGUE, no de código (constitución: apagado = 404 a propósito). Encenderla
en producción requiere acceso a la plataforma de hosting del cliente (fuera
de este repo) y, para el conector Google Calendar+Meet en vivo, credenciales
reales de un proyecto GCP (Client ID/Secret/Refresh token) que el dueño debe
conseguir — no se pueden generar por código.

**Cómo aplica**: antes de "construir" cualquier pieza de Citas/Agenda que el
dueño reporte como faltante, verificar primero si ya existe tras la bandera —
ver [[feedback-audit-before-build]].
