# Guion E2E — Filtros de prueba/sistema y archivado entre módulos

> Nace de la auditoría funcional del 17 sep 2026 (reporte del dueño): la
> casilla "Ocultar datos de prueba/sistema" no persistía al navegar, un
> contacto llamado "[Prueba] …" pero clasificado `real` parecía "no
> filtrarse" sin explicación, y un contacto ARCHIVADO seguía como trato activo
> en Pipeline y visible en Bandeja. No automatizado todavía en
> `scripts/e2e-selftest.mjs` — pendiente de sumarse ahí; mientras tanto este
> guion es la referencia manual.

## Vocabulario que este guion fija (para no repetir la ambigüedad del reporte)

- **`archivedAt`** (Contactos → Archivar): "hoy no trabajo este contacto".
  Reversible, nunca borra nada, y jamás se infiere solo — es un botón.
- **`sampleType`** (`demo` | `system` | null): "este contacto no es un
  prospecto real". Manual, nunca automático, nunca por nombre. `demo` =
  `seedDemo`; `system` = artefactos como el contacto "WhatsApp Business" que
  crea el botón de prueba de developers.facebook.com.
- Ambos son **ortogonales**: un contacto puede estar archivado y ser real, o
  sin archivar y ser demo. Ninguno de los dos borra al otro.

## 1. Persistencia del filtro de prueba/sistema (Contactos)

1. En `/contacts`, activar "Ocultar datos de prueba/sistema" sobre un
   contacto con `sampleType` fijado (o cargar la demo primero: botón "Cargar
   datos de demostración" en la Bandeja vacía).
   ✅ Los 8 contactos de "Ferretería El Martillo" desaparecen de la lista.
   ✅ El contador junto a "Contactos" pasa de N a N-8, y la etiqueta muestra
   "(8 ocultos)".
2. Recargar la página (F5) sin tocar nada más.
   ✅ La casilla sigue marcada (persistida en `localStorage`, por navegador).
   ✅ La lista y el contador coinciden: los mismos 8 siguen ocultos.
3. Navegar a Pipeline y volver a Contactos.
   ✅ La casilla conserva su estado (no depende del ciclo de vida del
   componente, sino de `localStorage`).

## 2. El filtro no reclasifica por nombre — y lo explica

4. Crear (o editar) un contacto real con el nombre `[Prueba] Cliente nuevo`,
   dejando "Tipo de dato" en "Prospecto real (normal)".
   ✅ Con "Ocultar datos de prueba/sistema" activo, este contacto **sigue
   visible** — el filtro nunca mira el nombre.
   ✅ La fila muestra un badge "¿Prueba?" con tooltip explicando que el
   nombre sugiere una prueba pero el tipo es real, y dónde cambiarlo si
   corresponde.
5. Cambiar manualmente su "Tipo de dato" a "Contacto del sistema" y guardar.
   ✅ Ahora sí desaparece con el filtro activo (aparece con "Ver archivados"
   siempre irrelevante para esto — son controles independientes).

## 3. Archivar saca del Pipeline activo, sin borrar el historial

6. En Contactos, archivar un contacto que tiene un trato en curso en Pipeline.
   ✅ El badge "Archivado" aparece junto a su nombre en Contactos.
   ✅ En Pipeline (`/pipeline`), su tarjeta desaparece del tablero activo de
   inmediato (`GET /api/pipeline/board` ya no la incluye).
7. Si ese trato ya se había GANADO antes de archivar, revisar Resultados
   (`/results`) en el rango correspondiente.
   ✅ Sigue contando en el embudo/ingresos de ese periodo — archivar no
   reescribe el pasado (ver comentario de política en
   `server/results/metrics.ts`).
8. En Contactos, activar "Ver archivados".
   ✅ El contacto reaparece en la lista con el badge "Archivado"; "Editar" y
   "Desarchivar" siguen disponibles.

## 4. Bandeja: archivado no pierde mensajes nuevos

9. Con el mismo contacto archivado del paso 6, confirmar en `/inbox` (checkbox
   "Ver archivados" apagado, default) que su conversación **no** aparece en
   la lista activa.
10. Simular un mensaje entrante nuevo de ese contacto (wa-mock o el número
    real de pruebas).
    ✅ El mensaje se procesa igual que cualquier otro (nunca se suprime un
    webhook por el filtro visual).
    ✅ El contacto se DESARCHIVA automáticamente (`getOrCreateContactByIdentity`
    reactiva contactos archivados en cualquier evento entrante) y la
    conversación vuelve a la Bandeja activa sin recargar (SSE
    `conversation.updated`).
    ✅ No se duplicó el contacto ni la conversación — mismo `id` de antes.
11. Activar "Ver archivados" en Bandeja sobre OTRO contacto archivado sin
    mensajes nuevos.
    ✅ Aparece con el badge "Archivado"; las conversaciones activas siguen
    visibles también (el toggle agrega, no reemplaza).

## 5. Resultados excluye demo/system consistentemente

12. Con datos demo cargados, abrir `/results` en un rango que cubra su
    actividad.
    ✅ Ningún número (prospectos nuevos, ganados, embudo, origen, citas)
    cuenta a los contactos de "Ferretería El Martillo" — ya cubierto por
    `excludingSampleContacts`, verificado end-to-end aquí.
