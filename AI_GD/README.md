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

Scores are out of 100 and come from six published criteria, computed from the generated transcript:

| Criterion | Default weight |
| --- | ---: |
| Topic relevance | 25% |
| Communication and clarity | 20% |
| Knowledge and content quality | 20% |
| Participation and initiative | 15% |
| Logical reasoning | 10% |
| Listening and constructive engagement | 10% |

Set `RUBRIC_WEIGHTS` to change them (see Environment). Five numbers (`25,20,20,15,10`) drop the listening criterion and are normalised to 100. Knowledge and reasoning blend live per-contribution analysis with the final Gemini evaluation when available. Clarity is measured on whole speaking turns from the generated transcript, not on the short fragments speech recognition emits at each pause. Participation is calculated by application code from contributions, speech share, missed invitations, and technical status. The live room still shows the three-pillar view (`AI_WEIGHTS`); its overall figure uses the rubric.

## Transcript generator

Live lines are captured in each browser (Web Speech API) and stored per speaker. The generator then builds the transcript used for scoring and export:

- **Merge.** Same-speaker fragments less than 4 seconds apart become one turn, ordered by time, with offsets from the start of the discussion.
- **Export.** `GET /api/discussions/:id/transcript?format=txt|md|json|srt` (add `&download=1` to save). The host and joined participants can read it; scores are never included. Host buttons are on the session page.
- **Fill gaps from recordings.** If a participant has no live transcript (for example Firefox or Safari with no speech recognition) but consented to transcription and recording, their microphone recording is decoded with `ffmpeg` and transcribed by the offline Whisper worker. This runs automatically when scoring, and the host can re-run it with **Generate from recordings**. Live lines are never replaced, and generated lines are labelled "(from recording)". Timestamps are placed from the moment the person joined, so they are approximate.

Setup for recording transcription: install `ffmpeg` (or set `FFMPEG`), `pip install -r scripts/stt/requirements.txt`, and run `scripts/stt/fetch-stt-model.sh` (or `.ps1`). Without them, scoring continues with the live transcript and the report stays Incomplete for people who have none.

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

Before setup, set `DATABASE_URL`, `HOST_EMAIL` and `HOST_PASSWORD` in `.env` (copy `.env.example` first). `npm run setup` generates local secrets, applies the schema, creates the host account, and downloads a checksum-verified LiveKit server binary on Windows or Linux. Then open http://localhost:3000.

On macOS, LiveKit does not publish an official server binary. Start the optional container instead with `docker compose --env-file .env -f compose.livekit.yml up -d`. On Windows and Linux, if the download is unavailable, install Docker and use the same compose command.

`npm run setup` is needed after a fresh checkout or a schema change. After setup, `npm run dev` is enough.

There is one host account, and you choose its sign-in: `HOST_EMAIL` and `HOST_PASSWORD`. It is created automatically the first time the host signs in (no seed step), and changing `HOST_PASSWORD` changes the host password. Public registration cannot use the host email or choose a role; everyone else who registers is a participant.

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
| `npm run seed` | Optional: creates the host account now from `HOST_EMAIL` / `HOST_PASSWORD` |
| `npm test` | Unit tests in `test/*.test.ts` |
| `npm run typecheck` | Typecheck app, server, scripts, Prisma, and tests |
| `npm run build` | Production Next.js build |
| `npm start` | Production process; requires `npm run build` first |

## Environment

Copy `.env.example` to `.env`. Never commit `.env`.

**Required**

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (Neon, Supabase, Render, ...) |
| `JWT_SECRET` | Random string of 16+ characters (use 32+); signs the session cookie |
| `HOST_EMAIL`, `HOST_PASSWORD` | The one host account's sign-in. Password: 8 to 80 characters |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit project for video. Locally, `npm run setup` runs a local media server instead and generates the secret |

**Optional** (sensible defaults are built in)

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Enables Gemini analysis; without it the heuristic scorer is used. `AI_ENABLED=off` forces it off |
| `RUBRIC_WEIGHTS` | Five or six weights: topic relevance, communication, knowledge, participation, reasoning, listening. Default `25,20,20,15,10,10` |
| `APP_URL` | Public origin for invite links. Derived from the request when unset |
| `TRUST_PROXY=1`, `COOKIE_SECURE` | Needed only when running the bundled Node server behind a proxy such as Render |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Password-reset and invite email. Without SMTP, participants cannot reset a forgotten password by email |
| `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`, `STUN_URLS` | ICE servers; Google STUN is the default |
| `GEMINI_FLASH_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_FLASH_MODEL`, `GEMINI_FINAL_MODEL`, `GEMINI_CONCURRENCY`, `GEMINI_MAX_QUEUE`, `GEMINI_GROUNDING`, `AI_MAX_CALLS_PER_ROOM`, `AI_WEIGHTS` | Advanced AI tuning |
| `FFMPEG`, `STT_MODEL_DIR`, `PYTHON` | Recording transcription paths |
| `LIVEKIT_HOST`, `LIVEKIT_NODE_IP`, `LIVEKIT_BINARY` | Local media server only |

## Deploying

**Sign-in, dashboards, and reports** run on any host. On Vercel, set the required variables, and the `vercel-build` script applies the database schema during each build (so `DATABASE_URL` must be reachable at build time; for Supabase use the **Session pooler** string, because the direct `db.<ref>.supabase.co` host is IPv6-only and Vercel cannot reach it; `DIRECT_URL` is an optional second string for schema pushes if `DATABASE_URL` is the transaction pooler on port 6543). Open `/api/health` on your deployment to see which setting is missing. The host then signs in with `HOST_EMAIL` and `HOST_PASSWORD`.

**Live meetings do not run on Vercel.** They need a long-running Node process for Socket.IO (`server/index.ts`), which Vercel's serverless functions cannot host. Run the whole app on Render instead (this is what `render.yaml` is for), and keep Supabase as the database.

### Run live meetings on Render + Supabase + LiveKit Cloud

1. **LiveKit Cloud** (free tier): create a project at https://cloud.livekit.io and copy the WebSocket URL (`wss://...livekit.cloud`), API key and API secret.
2. **Render**: New -> Blueprint -> pick this repository. If the project sits in a sub-folder of the repo, set **Root Directory** to that folder.
3. In the Render dashboard set `DATABASE_URL` (Supabase **Session pooler** string), `HOST_EMAIL`, `HOST_PASSWORD`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and optionally `GEMINI_API_KEY`. `JWT_SECRET` is generated for you.
4. Deploy. The start command applies the database schema, so no manual database step is needed. Open `https://<your-app>.onrender.com/api/health` to confirm `"ok": true`.
5. Sign in as the host, create a discussion, and share the meeting link. Each participant joins from Chrome or Edge with microphone permission.

How each person gets a transcript and a score: every browser transcribes its own microphone (Chrome/Edge speech recognition) and sends the lines to the server tagged with that person. When the host ends the discussion, the server builds each person's transcript and scores it on the six criteria. The host sees every person's transcript and criterion scores on the session page; each participant sees their own on their report.

Limits to expect: Firefox and Safari have no speech recognition, so those people appear as Incomplete unless the optional recording transcription is set up (needs `ffmpeg` and Python, which Render's standard Node runtime does not include). Render's free plan sleeps after about 15 minutes idle, so open the app a minute before a session starts.

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
