# Checklist e-Instant MVP (Frontend)

## 0. Preparacion
- [x] Configurar runtime Node.js >= 18 y npm
- [x] Inicializar proyecto (React + Next.js) y anadir Phaser 3
- [x] Agregar lint/format (ESLint, Prettier) y scripts basicos (`dev`, `build`, `start`, `test`, `lint`)
- [x] Configurar alias/paths para `src/ui`, `src/game`, `src/api`

## 1. Arquitectura base
- [x] Crear event bus UI<->motor (`ui:*`, `game:*`)
- [x] Definir state machine Phaser (MENU -> LOADING -> READY -> REVEAL -> CASCADE_LOOP -> END_TICKET -> PACK_LIST/REPLAY/RESUMEN)
- [x] Modelar tipos/DTO para GameConfig, PlayOutcome, PackOutcome, CascadeStep
- [x] Loader inicial de configuracion remota por `clientCode/companyCode`

## 2. UI React (Next.js)
- [x] Pantalla selector de experiencia (nivel1, nivel2) y tamano de paquete (5/10/15/20)
- [x] Pantalla de loading/preload de assets
- [x] HUD de juego: control de apuesta, boton Play, display de totalWin
- [x] Modales de reglas e informacion legal
- [x] Selector de nivel para packs (nivel1/nivel2)
- [x] Vista de tickets del paquete con wins por ticket y accion "Ver/Replay"
- [x] Vista replay por ticket con navegacion de retorno a la lista
- [x] Resumen de paquete (totalBet, totalWin, bestIndex)

## 3. Motor Phaser
- [x] Renderizar tablero configurable (ej. 4x6) y assets tematicos
- [x] Animacion de reveal inicial basada en `grid0`
- [x] Aplicar secuencia de cascadas (`remove -> drop -> refill`) segun payload, sin RNG en cliente
- [x] Acumular y mostrar `winStep`/`totalWin`
- [x] Soporte de replay usando outcomes en memoria (sin nuevas llamadas al backend)
- [x] Indicador BONUS en HUD cuando se detecta simbolo N
- [ ] Minijuego de bonus (simbolo N) + canon O (pendiente de definicion)

## 4. Multi-cliente y theming
- [x] Consumir endpoint de configuracion por `clientCode/companyCode`
- [ ] Aplicar feature flags (habilitar modos y pack)
- [ ] Theming: logos, fondos, tipografias/colores
- [x] Moneda y formato numerico
- [ ] Parametrizar apuestas (min/max/step)
- [x] Parametrizar tamanos de pack permitidos

## 5. Backend de palo (minimo para front)
- [x] Servir configuracion estatica por cliente
- [x] Servir `/v1/play` y `/v1/pack-play` con outcomes mock (random)
- [x] Incluir `playId/packId`, `grid0`, `cascades[]`, `totalWin` (suficiente para replay)

## 6. Telemetria y diagnostico
- [x] Eventos: `game_loaded`, `config_loaded`, `play_started/finished`, `pack_started/finished`, `replay_opened/closed`, `error`
- [x] CorrelationId/sessionId en logs y requests
- [ ] Metricas basicas: latencia `/play` y `/pack-play`, FPS promedio (opcional)

## 7. QA y pruebas
- [x] Tests unitarios: transformaciones de cascada, state machine, formateo de moneda
- [ ] Tests de integracion: consumo de API stub, flujos nivel1/2, pack + replay
- [ ] Smoke manual: navegacion completa, replay multiple, cambio de cliente
- [ ] Validar tolerancia a errores (timeout backend, config faltante)

## 8. Entregables
- [ ] Build reproducible (dev y prod)
- [x] Instrucciones de ejecucion y pruebas en README
- [x] Checklist actualizado con estado real
