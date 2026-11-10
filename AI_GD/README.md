# Quorum

Quorum is a group-discussion platform. A host creates a session, participants join with a link and an access code, and the live room records who said what from each person's own microphone. After the discussion, Quorum scores participants and exports PDFs.

The app is running as one Node process on port 3000 (the website and Socket.IO) plus a local LiveKit media server on port 7880 (audio and video). Use `npm run dev`. `next dev` by itself does not start sockets or video.

## Roles

Each account has one role.

**Host**

- Creates discussions, shares the meeting ID, access code, and link, and can regenerate the code.
- Opens the live room, mutes or removes a participant, and can end the meeting for everyone.
- Sees every participant's score, the group summary, the combined scores, and the full transcript.
- Is not scored. Joining the room does not create a performance report for the host.

**Participant**

- Joins with a link or a meeting ID plus access code.
- Sees only their own evaluation and the shared transcript.
- Cannot open another person's score, the combined scores PDF, or the group summary PDF. Those requests return 403.
- Cannot use host actions.

## How a session runs

1. The host creates a discussion: title, topic, description, rules, date, start time, duration, maximum participants (2–40), speaking time, silence prompt, and mode.
2. Quorum returns a meeting ID, a numeric access code, and a shareable URL.
3. Each person passes a lobby: display name, camera preview, microphone test, camera and microphone toggles, and consent when transcription or recording is on.
4. In the room, people can mute, turn the camera off, share a screen, raise a hand, chat, and turn captions on. The host also has a live monitor.
5. Each browser transcribes its own microphone with the Web Speech API and sends finished lines to the server. The server stores the speaker, time, text, and a relevance label.
6. When the host ends the meeting, or when the scheduled duration plus two minutes elapses, Quorum scores participants and writes the reports.
7. PDFs are built when someone downloads them. They are not a stale file from an earlier run.

Modes:

- **Free-flow.** People speak when they are ready.
- **AI-moderated.** The moderator can invite someone who has not spoken. It does not interrupt a person who is already talking.

## Scoring

Scores are out of 100. Overall weights default to `40,25,35` and are normalized if configured:

| Pillar | Default weight |
| --- | ---: |
| Knowledge and understanding | 40% |
| Participation | 25% |
| Point of view and thinking | 35% |

Knowledge combines live understanding, accuracy, and relevance analysis with the final Gemini evaluation when available. Thinking combines reasoning, originality, and responses to others. Participation is calculated by application code from contributions, speech share, missed invitations, and technical status. Set `AI_WEIGHTS` to three comma-separated weights to change the normalized blend.

Each spoken line is labeled **Highly relevant**, **Relevant**, **Partially relevant**, or **Irrelevant** and, when Gemini is available, also receives an accuracy label, concepts, and short live analysis. The report includes speaking time, contribution count, missed opportunities, participation share, and evidence from the transcript.

What is deliberately not scored: appearance, facial expression, gender, accent, and personality.

Special cases:

- No speech: knowledge and thinking are 0, with the deterministic note “No contributions were recorded.” Participation is still calculated by code.
- Speech recognition unavailable, no media, or a disconnect with zero speech: the report is **Incomplete**. The overall score is empty. It is not a fake low content score.
- A muted microphone is not punished when the person already contributed enough (at least three contributions, or a speaking share close to a fair share).
- A missed invite counts only when the person has fewer than three contributions.
- Host mute and disconnects are recorded. They are not treated as a failed answer.

The host can correct a score. The correction requires a reason, and the original score stays visible.

## Gemini AI

With no Gemini key, AI analysis, topic briefings, Q&A, and final AI evaluation are disabled or fall back to the built-in heuristics. The UI and reports identify heuristic results; they do not represent them as Gemini output.

Create a Gemini API key in Google AI Studio and place it in `AI_GD/.env`. A single `GEMINI_API_KEY` works for both live and final tasks; separate keys and model names are optional:

```
AI_ENABLED=on
GEMINI_API_KEY=your-server-side-key
GEMINI_FLASH_MODEL=gemini-2.5-flash
GEMINI_FINAL_MODEL=gemini-2.5-flash
```

For separate keys, set `GEMINI_FLASH_API_KEY` for live analysis and `GEMINI_API_KEY` for final work. Either key alone can service both tiers. `AI_ENABLED=off` disables all Gemini calls. Restart `npm run dev` after changing `.env`. Keep API keys server-side; never expose them through `NEXT_PUBLIC_*` variables or commit `.env`.

Gemini requests use bounded concurrency, prioritized final work, retries for transient errors, and per-discussion call budgets. On an outage, invalid key, timeout, or rate limit, live analysis and final scoring fall back to heuristics. The app does not claim that heuristic output came from Gemini.

**Privacy and cost:** When AI is enabled, discussion transcripts and host-provided context are sent to Google Gemini for analysis and evaluation. The join screen discloses this. Review Google's data-use terms for your API plan before enabling the feature. Gemini API use may incur cost and is subject to model quotas/rate limits. Optional search grounding is off by default; enable it with `GEMINI_GROUNDING=on` for Q&A, and verify any sourced claims independently.

## AI moderator

The moderator runs about every four seconds, one action at a time, and only while the host left it enabled:

- Prompt the room after a long silence.
- In AI-moderated mode, invite a quiet participant once.
- Ask a dominant speaker to leave room.
- Redirect the room when the recent lines are off topic.
- Give a closing summary near the end.

Default wording is a template. Gemini may create an aliased, tailored question when enabled; the template is kept if generation fails or exceeds the word limit.

## Video

Audio and video go through LiveKit, which `npm run dev` starts from `bin/livekit-server.exe`. One room holds up to 40 people. Socket.IO still carries the transcript, chat, roster, speaking time, and moderator notices.

Ports:

| Port | Use |
| --- | --- |
| 3000 | Website and Socket.IO |
| 7880 | Media server HTTP and WebSocket |
| 7881 | Media TCP |
| 7882 | Media UDP |

The media server advertises this computer's Wi-Fi address so other devices can connect. VirtualBox's `192.168.56.x` address is skipped. Set `LIVEKIT_NODE_IP` if you need a specific address. Set `LIVEKIT_URL` if browsers should use a different WebSocket address than `ws://<page-host>:7880`.

`http://localhost` can use the camera and microphone. A phone on the same Wi-Fi needs HTTPS. Create a certificate and use HTTPS:

```bash
npm run cert
npm run dev:https
```

Accept the browser's certificate warning. Allow ports 3000/TCP, 7880/TCP, 7881/TCP, and 7882/UDP through the firewall for LAN access. For HTTPS-hosted rooms, configure `LIVEKIT_URL` to a secure `wss://` LiveKit endpoint; the local development media listener on port 7880 does not itself terminate TLS.

## Start again tomorrow

From the `AI_GD` folder:

```bash
npm install
npm run setup
npm run dev
```

Before setup, set `DATABASE_URL` in `.env` to your PostgreSQL connection string. For Supabase, copy the PostgreSQL connection string from **Project Settings → Database**; the project URL alone is not a database connection string. Set `SEED_PASSWORD` to a unique password of at least 16 characters before running setup. `npm run setup` creates `.env` if needed, generates local JWT and LiveKit secrets, applies the schema, provisions the fixed host and a demo participant, and downloads a checksum-verified LiveKit server binary on Windows or Linux. Then open http://localhost:3000.

On macOS, LiveKit does not publish an official server binary. Start the optional container instead with `docker compose --env-file .env -f compose.livekit.yml up -d`. On Windows and Linux, if the download is unavailable, install Docker and use the same compose command.

`npm run setup` is needed after a fresh checkout or a schema change. After setup, `npm run dev` is enough.

The host account is provisioned only by the trusted seed process. Its email is fixed to `karthiksathish1820@gmail.com`; public registrations cannot create this account or choose a role. `npm run seed` sets the host role for that account and demotes any other host accounts to participants. New public registrations are participants.

- Host: `karthiksathish1820@gmail.com`
- Participant: `participant@quorum.local`
- Password: the value of `SEED_PASSWORD` in `.env`

A second participant needs another registered participant account, or a second browser profile. Video needs two browsers.

If a session was left live when the server stopped, open it and choose **End and score** to close it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Website, Socket.IO, and the media server |
| `npm run dev:https` | Same, with `certs/key.pem` and `certs/cert.pem` |
| `npm run cert` | Creates a local self-signed certificate |
| `npm run setup` | First-run configuration, database setup, seed, and media binary |
| `npm run fetch:livekit` | Download and verify the official LiveKit release binary |
| `npm run db:push` | Applies `prisma/schema.prisma` to PostgreSQL |
| `npm run seed` | Creates the demo host and participant |
| `npm test` | Unit tests in `test/*.test.ts` |
| `npm run typecheck` | Typecheck app, server, scripts, Prisma, and tests |
| `npm run build` | Production Next.js build |
| `npm start` | Production process; requires `npm run build` first |

## Environment

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; for Supabase, copy it from Project Settings → Database |
| `JWT_SECRET` | Required; signs the `quorum_token` session cookie (at least 16 characters) |
| `APP_URL` | Public origin, used in links |
| `TRUST_PROXY` | Set to `1` only behind a trusted reverse proxy that overwrites forwarded headers |
| `COOKIE_SECURE` | Optional `on`/`off`; otherwise follows the request protocol |
| `AI_ENABLED` | Set to `off` to disable Gemini even when a key is configured |
| `GEMINI_API_KEY`, `GEMINI_FLASH_API_KEY` | Server-side Gemini keys; either one can be used for both tiers |
| `GEMINI_BASE_URL`, `GEMINI_FLASH_MODEL`, `GEMINI_FINAL_MODEL` | Optional API endpoint and tier models |
| `GEMINI_CONCURRENCY`, `GEMINI_MAX_QUEUE`, `AI_MAX_CALLS_PER_ROOM` | AI queue and discussion-call limits |
| `AI_WEIGHTS` | Three comma-separated weights for knowledge, participation, and thinking; default `40,25,35` |
| `GEMINI_GROUNDING` | Optional Q&A search grounding; default `off` |
| `REPORT_VISIBILITY` | Reserved report visibility setting; default `own` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Password-reset and invite email. Empty SMTP shows the reset link on the page in development |
| `LIVEKIT_HOST` | Media server HTTP address, default `http://127.0.0.1:7880` |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Must match the key pair passed to the media server |
| `LIVEKIT_NODE_IP` | Address advertised to other devices. Blank uses the Wi-Fi address |
| `LIVEKIT_URL` | Optional public WebSocket URL for browsers |
| `LIVEKIT_BINARY` | Optional path to a LiveKit executable; otherwise `bin/livekit-server[.exe]` |
| `STUN_URLS`, `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD` | ICE servers. Google STUN is the default. TURN is needed only for strict firewalls |
| `SEED_PARTICIPANT_EMAIL`, `SEED_PASSWORD` | Trusted seed account provisioning; use a unique password of at least 16 characters |

Passwords are hashed with bcrypt (cost 12). Password-reset tokens last 30 minutes.

## Layout

```
server/index.ts          Custom server: Next.js, Socket.IO, LiveKit process
src/server/signaling.ts  Room events: join, transcript, chat, mute, remove, end
src/server/livekit.ts    Room tokens, host mute, host remove
src/server/scoring.ts    Score formula
src/server/ai.ts         Lexical model and optional language-model calls
src/server/evaluate.ts   End-of-meeting scoring. Skips the host
src/server/moderator.ts  Silence, invites, balance, off-topic, wrap-up
src/server/pdf.ts        Individual, summary, combined, and transcript PDFs
src/app/host             Host dashboard and session pages
src/app/participant      Participant dashboard, join, and own report
src/app/meeting          Lobby and live room
src/components/MeetingApp.tsx   Live room UI
prisma/schema.prisma     Users, discussions, transcript, scores, reports
bin/livekit-server       Downloaded media binary. Not committed
data/recordings          Per-person microphone files, uploaded on leave
```

## Privacy of reports

- Participant page and individual PDF: that person's score only.
- Shared transcript PDF and the transcript API: everyone's lines, because the transcript is shared. Scores are not included there.
- Summary PDF and combined scores PDF: host only.
- The discussion JSON for a participant omits the access code, other people's scores, and other people's speaking stats.

## Tests

```bash
npm test
npm run typecheck
```

The scoring tests cover an on-topic line, an off-topic line, a reply that stays relevant, weights that sum to 1, silence, speech recognition unavailable, and a muted person who already contributed enough.

## Limits

- Speech recognition needs Chrome or Edge. Firefox often has no `SpeechRecognition` API. That person's report is Incomplete.
- Very short noise (under two words, except yes, no, agree, and disagree) is dropped. The same line repeated within eight seconds is dropped.
- Recordings are each person's microphone as WebM, not a mixed gallery video.
- The device dropdown in the lobby lists microphones and cameras. Changing it does not restart the capture that is already open.
- Invite email and password-reset email send only when SMTP is set.
- The moderator invites each quiet person once.
- Rooms above 40 are rejected. A room this large still depends on this computer's CPU and on UDP port 7882 being reachable.
