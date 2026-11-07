# AI GD Platform (Roundtable)

## Run
**Quick (no services):** `cd backend && npm install && npm start` → http://localhost:3000. Sign in as `admin@example.com` / `admin123` (set `ADMIN_EMAIL`, `ADMIN_PASSWORD`). Falls back to in-memory state and a WebRTC mesh.
**Full stack:** `cp .env.example .env && docker compose up --build` (Postgres+pgvector, Redis, LiveKit, app). Docker files are untested here; the same stack was tested natively.
**Tests:** `cd backend && npm test` (unit + integration; `REDIS_URL` enables the crash-recovery test). E2E: `python3 tests/e2e/session_e2e.py` with `BASE_URL` pointing at a running full stack.

## Stage plan
| Stage | Scope | Status |
|---|---|---|
| 1 Foundation | scaffold, migrations, roles | done |
| 2 Speaking floor | session manager, floor controller, 3 s silence rule, fair-turn scheduler, raise hand | done |
| 3 Client UX | circular table, speaker spotlight, 3 reading modes, transcript download | done |
| 4 Evaluation | participation + knowledge + topic-relevance report | done |
| 5 Real-time media | LiveKit SFU, server-enforced mic permission, server-side Whisper transcription, end-of-turn detection, network diagnostics + recovery probe, mesh fallback | done |
| 6 Persistence | PostgreSQL + pgvector (write-behind), Redis (rate limits, snapshots), DB recovery | done |
| 7 Hardening | JWT auth, scrypt, hashed participant tokens, production config guard, TURN, Docker, CI, unit/integration/e2e/load tests | done |

## Verified (all run in this repo's sandbox)
| What | How | Result |
|---|---|---|
| Unit + integration (12 tests) | `npm test` against real PostgreSQL+pgvector and Redis | 12/12 |
| Browser e2e, 4 participants + host | real LiveKit, fake camera, synthesized speech as microphone | all checks pass |
| Server-side STT | Whisper tiny.en via sherpa-onnx, attributed to the floor holder | works; ~1 word in 6 wrong on robotic TTS, first turn can start mid-sentence |
| Mic permission | non-speaker publish attempt denied by LiveKit server | enforced |
| End-of-turn | silent floor holder released after 8 s | works |
| Real packet loss | iptables drops 90% of one browser's UDP | detected in ~7 s, camera paused, host alerted, others unaffected, no false recovery, recovers via probe |
| Crash recovery | kill -9 + restart, from Redis and from PostgreSQL | both work |
| TURN | HMAC credentials against real coturn | relays with 0% loss; wrong secret rejected |
| Load | 30 rooms x 10 participants (330 sockets), 30 s | p50 3 ms, p95 151 ms floor grant, ~20% of one CPU, 150 MB, 0 errors |
| Container | Dockerfile steps replayed natively, YAML parsed, production boot | works; `docker build` itself not run (no Docker here) |

## Known limits
No delay/jitter injection (kernel has no netem), so only loss was tested on a real path. Embeddings default to a local hashed model (an OpenAI-compatible endpoint can be configured via `EMBEDDINGS_URL`, verified against a mock only). Whisper tiny.en is small; use a larger model or a cloud STT for production. Mesh fallback is for demos (<= ~6 people).

## Backend reliability design
- Server-authoritative floor; every mutation bumps a version so clients drop stale state; one coalesced broadcast per room every 250 ms.
- Authenticated reconnect (id + secret token), stale-socket replacement, floor auto-released if the speaker drops.
- Heartbeat ping/pong, token-bucket rate limit, payload caps, input validation, idempotent end-of-meeting.
- Network meter: EWMA + hysteresis (degrade after 2 samples, recover after 5) from client WebRTC stats and server RTT.
- Append-only journal + atomic final snapshot per room in `backend/data/` (set `DATA_DIR`).
- Production: replace the mesh with LiveKit (SFU) and add a TURN server; mesh is fine for demos but costs uplink per extra peer.
