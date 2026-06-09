# 🐾 Ojo al Perro · Rocha

Mapa comunitario, anónimo y gratuito para reportar **perros sueltos, agresivos o en situación de abandono** en el departamento de Rocha, Uruguay.

La gente de Rocha puede:

- 🗺️ **Ver el mapa** con todos los reportes (Leaflet + OpenStreetMap, sin API keys ni costos)
- ➕ **Reportar en 3 pasos**: qué pasó → pin en el mapa → link a fotos
- 📷 **Adjuntar fotos/videos** con un link público de su propio Google Drive (la app no almacena archivos → hosting gratis y liviano)
- 👍 **Votar** «a mí también me pasó» y 💬 **comentar** con sus propios testimonios y links
- 🆘 Encontrar los **teléfonos de Bienestar Animal** (INBA 0800 5384, Intendencia de Rocha 1955 int. 149, 911) y consejos de seguridad ante perros agresivos
- 📲 **Instalarla como app** (PWA): funciona desde la pantalla de inicio del celular

Todo es **anónimo**: no hay cuentas ni datos personales. El spam se controla con rate-limiting por IP (las IPs se guardan *hasheadas con sal*, nunca en claro), un honeypot para bots, un token con tiempo mínimo de envío y topes diarios por conexión.

## Correr en local

```bash
npm install
npm start
# → http://localhost:3000
```

Requiere Node 18+. La base SQLite se crea sola en `data/reportes.db`.

## Desplegar en Render (recomendado)

1. Subí el repo a GitHub.
2. En [Render](https://render.com): **New → Blueprint** y elegí este repo (usa `render.yaml`).
3. ¡Listo! En el plan **free** el disco es efímero (los datos se reinician con cada deploy). Para datos persistentes, usá el plan Starter y descomentá la sección `disk` de `render.yaml`.

> ¿Vercel/Netlify? Son plataformas *serverless* sin disco persistente, así que SQLite no sobrevive entre invocaciones. Este servidor está pensado para Render, Railway, Fly.io o cualquier VPS chico.

## Variables de entorno (opcionales)

| Variable | Para qué |
|---|---|
| `PORT` | Puerto del servidor (default `3000`) |
| `DATA_DIR` | Carpeta de la base de datos (default `./data`) |
| `IP_SALT` | Sal fija para hashear IPs (si no, se genera al arrancar) |
| `TOKEN_SECRET` | Secreto de los tokens anti-bot (si no, se genera al arrancar) |
| `ADMIN_KEY` | Habilita moderación: `curl -X DELETE -H "X-Admin-Key: $ADMIN_KEY" https://tuapp/api/reports/123` |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/reports` | Últimos 500 reportes con votos y nº de comentarios |
| `GET` | `/api/reports/:id` | Detalle + comentarios |
| `POST` | `/api/reports` | Crear reporte (máx. 4/hora y 10/día por IP) |
| `POST` | `/api/reports/:id/comments` | Comentar (máx. 15/hora por IP) |
| `POST` | `/api/reports/:id/vote` | Votar / quitar voto (1 por dispositivo) |
| `GET` | `/api/token` | Token anti-bot para los formularios |
| `DELETE` | `/api/reports/:id` | Borrar (requiere header `X-Admin-Key`) |

## Stack

Express + better-sqlite3 en el backend; HTML/CSS/JS vanilla + Leaflet en el frontend. Sin frameworks, sin build step, sin API keys. Los íconos PNG de la PWA se regeneran con `npm run icons`.
