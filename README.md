# Mi ASPCH

Mi ASPCH es una aplicación Node.js/PWA para los socios de la Asociación de
Pilotos de Chile. Producción ejecuta actualmente la versión `0.6.15`.

## Fuentes de verdad

- Código y documentación vigente: `/home/casa/mi-aspch-source`.
- Contexto IA y decisiones: `/home/casa/mi-aspch-source/.ai`.
- Runtime y datos actuales: volumen Docker `aspch_mi_aspch_data` y mounts bajo
  `/mnt/MediaCenter/aspch`.

`/mnt/MediaCenter/aspch` es legado/runtime: no debe usarse como fuente de código
ni como contexto de build. Los documentos antiguos conservados en
`docs/history/` tampoco son normativos.

## Despliegue declarado

La única definición canónica de despliegue es `compose.yaml`. Está alineada con
producción `0.6.15`, fija la imagen por tag y digest, reutiliza explícitamente el
volumen externo `aspch_mi_aspch_data` y conserva el puerto, entorno y bind mounts
actuales. El archivo no debe aplicarse sin una tarea de despliegue autorizada.

## Desarrollo

La aplicación se inicia con `npm start` y se valida con `npm run check`. Git no
está inicializado. `.env`, credenciales, SQLite, fotos y backups no forman parte
de la fuente documental ni deben copiarse a `.ai/`.
