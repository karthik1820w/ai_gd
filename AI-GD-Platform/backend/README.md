# Backend

Node 22 (ESM). One process serves HTTP (REST + static UI) and WebSocket. State is authoritative in memory, journaled to disk, written behind to PostgreSQL, snapshotted to Redis.

## Run
`npm install && npm start` (dev: no services needed). Full stack: set `DATABASE_URL`, `REDIS_URL`, `LIVEKIT_*` (see `.env.example`). `NODE_ENV=production` refuses to boot with default secrets. STT needs `sh ../scripts/fetch-stt-model.sh` and `pip install -r ../ai-engine/speech/requirements.txt`.

## Layout
| Path | Role |
|---|---|
| `src/server.js` | boot: config guard, migrations, admin seed, recovery, HTTP + WS |
| `src/config.js` | production safety checks |
| `src/routes/api.js` | `/healthz`, `POST /api/auth/login`, `GET /api/sessions`, `/vendor/livekit-client.umd.js`, UI |
| `src/websocket/gateway.js` | sockets, heartbeat, rate limit, validation, 250 ms coalesced broadcast, mic-permission reconciler |
| `src/services/floorController.js` | rooms, floor, hands, silence rule, transcript, snapshot/restore |
| `src/middleware/auth.js` | scrypt passwords, HS256 JWT, admin seed |
| `src/middleware/rateLimit.js` | token bucket per socket |
| `src/modules/db.js`, `persist.js` | migrations, write-behind queue, recovery query |
| `src/modules/redis.js` | rate limits (cross-instance), room snapshots |
| `src/modules/livekit.js` | tokens, server-enforced mic permission |
| `src/modules/transcriber.js` | hidden LiveKit participant + VAD + STT per utterance |
| `src/modules/netQuality.js` | EWMA + hysteresis network meter |
| `src/modules/ice.js` | STUN/TURN (coturn HMAC credentials) for mesh mode |
| `src/modules/journal.js` | append-only JSONL + atomic final snapshot |
| `../ai-engine/` | fair-turn scheduler, evaluation, embeddings, STT worker |
| `../database/migrations/` | `001_init.sql`, `002_recovery.sql` |

## WebSocket protocol (JSON)
Client -> server: `create {jwt,topic,keywords}`, `admin_join {jwt,code}`, `join {code,name,[id,token]}`, `start`, `end`, `speak_start`, `speak_stop`, `speech {text}`, `hand_raise`, `hand_lower`, `media {mic,cam}`, `net {rtt,loss}`, `rtc {to,data}` (mesh signalling).
Server -> client: `joined {code,id,token,media,stt,ice}`, `state {v,...}` (versioned, ignore stale), `announce {text}`, `notice {level,text}`, `alert {id,name,level}`, `lk {url,token}`, `rtc {from,data}`, `error {message}`.

## Environment
`PORT, DATABASE_URL, REDIS_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_PUBLIC_URL, STT (off to disable), STT_MODEL_DIR, STT_RMS, TURN_URLS, TURN_SECRET, EMBEDDINGS_URL/KEY/MODEL, JOIN_LIMIT, TRUST_PROXY, DATA_DIR, ANTHROPIC_API_KEY (LLM knowledge scoring)`.

## Tests
`npm test` (unit + integration; `DATABASE_URL`/`REDIS_URL` enable the DB, recovery and production tests). `node ../tests/load/load.mjs` for load. `python3 ../tests/e2e/session_e2e.py` and `network_e2e.py` for browser e2e (full stack, root + iptables for the network test).
