---
name: health-expone-commit
description: /api/health responde {ok, version, commit} — permite verificar qué commit corre en producción sin acceso a Coolify (MCP/SSH), solo con curl público.
metadata:
  type: reference
---

`GET https://crm.masimpulsodigital.com/api/health` responde JSON con
`commit` (short SHA de 7 chars) además de `ok`/`version`. Esto resuelve la
limitación de [[ruta-a-coolify-webhook]] (sin MCP/SSH desde este checkout):
para saber si el deploy en producción quedó al día basta comparar ese
`commit` contra `git log --oneline` local — no hace falta pedirle al dueño
que pegue el dashboard de Coolify solo para esto.

**Cómo aplicar**: antes de decirle al dueño "no puedo verificar el commit
desplegado", correr primero
`curl -s https://crm.masimpulsodigital.com/api/health` y comparar el
`commit` recibido contra `git log --oneline <SHA_local>` (usar
`git cat-file -e <sha>` para confirmar que es ancestro). Solo pedir el
dashboard de Coolify si se necesita el estado del build (éxito/fallo/en
progreso) o logs, que el healthcheck no expone.
