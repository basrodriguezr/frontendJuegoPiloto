# e-Instant MVP (Frontend) - Guia de ejecucion y pruebas

Este README resume como ejecutar el frontend (React + Next.js + Phaser) del MVP, usar el backend de palo y correr pruebas.

## Prerrequisitos
- Node.js >= 18 y npm (o pnpm/yarn si se habilita).
- Acceso local al backend (Express + Postgres) que expone WebSocket para config/outcomes.

## Instalacion
```bash
npm install
```
Si usas pnpm:
```bash
pnpm install
```

## Ejecucion (desarrollo)
```bash
npm run dev
```
- Inicia el servidor dev de Next en `http://localhost:3000` (o el puerto configurado).
- Variables `NEXT_PUBLIC_CLIENT_CODE` y `NEXT_PUBLIC_COMPANY_CODE` se leen desde `.env.local` para cargar tema/parametros del cliente.
- Alias `@/*` apunta a `./src/*` (usado por Next y Vitest).

## Build y produccion
```bash
npm run build
npm run start   # servir el build de Next en modo produccion
```

## Docker (local y VM)
Este proyecto usa fuentes locales (`@fontsource`) para evitar descargas en build y funciona sin acceso a Google Fonts.

### Build y run local (sin Docker Compose)
```bash
docker build -t piloto-app .
docker run -d --name piloto-app -p 3000:3000 piloto-app
```
Abrir: `http://localhost:3000`

## Backend (Express + Postgres)
El backend vive en `../backend/` y expone:
- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- WebSocket `ws://HOST:4000/ws` con mensajes:
  - `config.get`
  - `play.single`
  - `play.pack`

### Tareas implementadas (detalle)
- **Auth JWT**: registro/login/`me` con hash de password y token JWT.
- **Config de juego**: devuelve config desde DB si existe; si no, usa stub.
- **Play / Pack-play**: genera outcomes con stubs y persiste en Postgres.
- **Persistencia**: tablas `users`, `game_configs`, `plays`, `pack_plays`.
- **Migraciones**: `../backend/sql/001_init.sql` + runner `npm run migrate`.
- **Docker**: imagen backend con migraciones al iniciar.
- **Compose (opcional)**: stack completo frontend + backend + postgres.

### Ejecutar backend local (sin Docker)
```bash
cd ../backend
npm install
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/piloto
export JWT_SECRET=dev-secret
npm run migrate
npm run seed
npm run dev
```

## Docker Compose (opcional)
No se usa en el despliegue actual de la VM, pero puede servir en local.
```bash
cd ..
docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- Postgres: `localhost:5432`

El frontend apunta al backend usando `NEXT_PUBLIC_WS_URL` en build args.

### Ejecucion paso a paso (Docker Compose)
1) Asegura Docker y Docker Compose instalados.
2) Levanta stack completo:
   ```bash
   cd ..
   docker compose up --build
   ```
3) Verifica servicios:
   ```bash
   docker ps
   ```
4) Prueba backend:
   ```bash
   curl http://localhost:4000/api/v1/health
   ```
5) Abre frontend:
   `http://localhost:3000`

### Seeds (datos iniciales)
Los seeds viven en `../backend/sql/002_seed.sql` y se aplican con:
```bash
cd ../backend
npm run seed
```
Incluye usuario demo y config base.
Usuario demo:
- email: `demo@piloto.local`
- password: `Demo1234!`

### Variables de entorno backend
Archivo ejemplo: `../backend/.env.example`
- `DATABASE_URL`
- `JWT_SECRET`
- `PORT`

### Acceso desde VM (VirtualBox NAT)
Si la VM esta en NAT, configura port forwarding:
- Host port: 3000 -> Guest port: 3000
- Host IP: 127.0.0.1
- Guest IP: (ej. 10.0.2.15)

Luego abre en el host: `http://127.0.0.1:3000`

## Deploy con GitHub Actions (self-hosted runner en la VM)
El workflow esta en: `.github/workflows/deploy-dev.yml`.
Despliega localmente en la VM (sin SSH) usando `docker build` + `docker run`.

Pasos resumidos:
1) Instalar runner en la VM y dejarlo **online**.
2) Hacer `git push` a `main` o disparar el workflow manual.
3) Verificar con `docker ps` en la VM.

## Variables de entorno
El frontend usa `NEXT_PUBLIC_WS_URL` si necesitas apuntar a un backend externo.
Crea `.env.local` (no commitear) con, por ejemplo:
```
NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
NEXT_PUBLIC_CLIENT_CODE=acme
NEXT_PUBLIC_COMPANY_CODE=acme
NEXT_PUBLIC_GAME_CODE=e-instant
```

## Backend de palo
- Mensajes esperados (via WebSocket):
  - `config.get`
  - `play.single`
  - `play.pack`
- Para desarrollo, puedes levantar un stub local que responda los mensajes con outcomes y config por cliente.
- Asegurate de que el payload incluya `grid0`, `cascades[]`, `totalWin`, `playId`/`packId` y `gridAfter` por paso (suficiente para replay).

## Pruebas
- Unitarias (Vitest + Testing Library):
```bash
npm run test
npm run test:watch
```
  - Validar transformaciones de cascada, state machine y formateo de moneda.
- Integracion/E2E (Playwright):
```bash
npx playwright install chromium   # instalar navegador para e2e
npm run test:e2e                  # levanta dev server y corre e2e
```
  - Flujos nivel1/nivel2, paquete + replay usando el backend stub (ajusta payloads para que sean deterministas).
- Lint/format:
```bash
npm run lint
npm run format
npm run format:check
npm run type-check
```

## Revision rapida de funcionalidades (manual)
- Cambiar clientCode/companyCode y verificar cambio de branding/params.
- Ejecutar modo nivel1 y nivel2 con outcomes del stub; confirmar cascadas y totalWin.
- Ejecutar paquete (5/10/15/20), ver lista de tickets, abrir replay de multiples tickets y volver atras.
- Validar manejo de timeouts/errores del stub (mensaje UI y reintentos si aplica).

## Recursos utiles
- Checklist de tareas: `CHECKLIST.md`
- Documentacion funcional: `documento de definicion videojuegos.pdf`
