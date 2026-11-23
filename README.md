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
- Sees only their own score and their own transcript. Nobody else's words or scores are ever sent to them.
- Cannot open another person's score, the combined scores PDF, or the group summary PDF. Those requests return 403.
- Cannot use host actions.

## How a session runs

1. The host creates a discussion: title, topic, description, rules, date, start time, duration, maximum participants (2–40), speaking time, silence prompt, and mode.
2. Quorum returns a meeting ID, a numeric access code, and a shareable URL.
3. Each person passes a lobby: display name, camera preview, microphone test, camera and microphone toggles, and consent when transcription or recording is on.
4. In the room, people can mute, turn the camera off, share a screen, raise a hand, chat, and turn captions on. The host also has a live monitor, a hand queue, and the mute button. The camera is always the person's own decision.
5. Each browser transcribes its own microphone with the Web Speech API and sends finished lines to the server. The server stores the speaker, time, text, and a relevance label.
6. When the host ends the meeting, everyone's room closes at once. When the scheduled duration is up the meeting also ends by itself (someone mid-sentence gets up to 20 seconds to finish), whether or not the host is connected. Then Quorum scores participants and writes the reports.
7. PDFs are built when someone downloads them. They are not a stale file from an earlier run.

Modes:

- **Free-flow.** People speak when they are ready.
- **AI-moderated.** When the floor has been open for 5 seconds the moderator invites someone: the first hand in the queue, or else the person who has spoken least. It never speaks over a person, and its voice is cut off the moment anyone starts talking.

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

Set `RUBRIC_WEIGHTS` to change them (see Environment). Five numbers (`25,20,20,15,10`) drop the listening criterion and are normalised to 100. Numeric criteria are computed deterministically from captured evidence; Gemini provides qualitative feedback only. Clarity is measured on whole speaking turns from the generated transcript, not on the short fragments speech recognition emits at each pause. Participation is calculated from measured participation: joining gives a 5-point baseline; qualifying turns, speaking time, relevant contributions, and observed replies can add points. Technical problems do not award or deduct participation points. Missing criterion evidence is left unscored and the overall score is renormalised across measured criteria. The live room still shows the three-pillar view (`AI_WEIGHTS`); its overall figure uses the rubric.

## Transcript generator

Live lines are captured in each browser (Web Speech API) and stored per speaker. The generator then builds the transcript used for scoring and export:

- **Merge.** Same-speaker fragments less than 4 seconds apart become one turn, ordered by time, with offsets from the start of the discussion.
- **Export.** `GET /api/discussions/:id/transcript?format=txt|md|json|srt` (add `&download=1` to save). The host can read everyone's (or one person's with `&speaker=<participantId>`); a participant always gets only their own lines. Scores are never included. Host buttons are on the session page.
- **Fill gaps from recordings.** If a participant has no live transcript (for example Firefox or Safari with no speech recognition) but consented to transcription and recording, their microphone recording is decoded with `ffmpeg` and transcribed by the offline Whisper worker. This runs automatically when scoring, and the host can re-run it with **Generate from recordings**. Live lines are never replaced, and generated lines are labelled "(from recording)". Timestamps are placed from the moment the person joined, so they are approximate.

Setup for recording transcription: install `ffmpeg` (or set `FFMPEG`), `pip install -r scripts/stt/requirements.txt`, and run `scripts/stt/fetch-stt-model.sh` (or `.ps1`). Without them, scoring continues with the live transcript and the report stays Incomplete for people who have none.

Each spoken line is labeled **Highly relevant**, **Relevant**, **Partially relevant**, or **Irrelevant** and, when Gemini is available, also receives an accuracy label, concepts, and short live analysis. The report includes speaking time, contribution count, missed opportunities, participation share, and evidence from the transcript.

What is deliberately not scored: appearance, facial expression, gender, accent, and personality.

Special cases:

- No measured evidence for a criterion: that criterion is unscored. If no criteria have evidence, the overall report says **Not enough data**.
- Speech recognition unavailable, media unavailable, or a technical/disconnect event: the report carries an explicit warning. Technical issues do not add participation points or create made-up content scores.
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

The moderator checks every second, takes one action at a time, and runs while the host left it enabled (or while the host is away, see below):

- Prompt the room after a long silence.
- Invite someone once the floor has been open for 5 seconds: hand queue first, then the quietest connected person (anyone the host has muted is skipped).
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

## Transcript diagnostics

The cause of transcript omissions, duplicates, timing errors, or speaker attribution issues has not been established. Keep the root cause marked **unknown** until real session data is reviewed. Diagnostics are off by default and are opt-in because they can include transcript text.

Set `TRANSCRIPT_DIAGNOSTICS=1` in the server environment and restart the app. During an active session the server writes JSON Lines to `data/transcript-diagnostics/<meeting-id>.jsonl` (or under `DATA_DIR` if configured). Each record includes diagnostic stage, speaker and segment IDs, text, timing, and available confidence. Protect and delete these files as sensitive transcript data. Turn capture off by setting `TRANSCRIPT_DIAGNOSTICS=0` and restarting.

After collecting a real session file, run:

```bash
node scripts/diagnostics/analyze-transcript.mjs data/transcript-diagnostics/<meeting-id>.jsonl
```

The analyzer reports duplicate-final candidates, overlapping ranges, out-of-order times, speaker changes for the same segment ID, text marked during silence, low-confidence text, and arrival/end deltas. Its confidence threshold (default `0.5`) is diagnostic only and does not filter or alter scoring. Arrival/end deltas also include processing, network delay, and possible client/server clock offset; they cannot establish clock drift by themselves.

## Local validation environment

Next.js requires Node.js 20.9 or newer, and the installed `tsx` runner requires Node.js 18 or newer. This Windows environment must also allow Node's `os.userInfo()` to read the current OS account. On the affected machine, that native call fails with `uv_os_get_passwd returned ENOMEM`; the underlying cause remains unknown. Check it with `node -e "console.log(require('node:os').userInfo().username)"`. The failure has been observed with valid `USERNAME` and `USERPROFILE` values; setting those variables alone did not fix it. Run `npm test` only after the Node OS lookup succeeds. Do not use an application or committed test-runner workaround to conceal this host failure.

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


## The meeting room

- **Layouts.** Round table (default), Speaker focus, Gallery, and 3D table. Each person picks their own, and it is remembered. In the 2D layouts whoever speaks moves to the centre of the table; a short hold stops it jumping on a cough. Three reading modes (Sage, Paper, Night).
- **Video in the seat.** A person's camera shows inside their circle. The ring around the circle fills as they reach a fair share of the talking time; the dot shows connection quality.
- **AI invitations.** When nobody has spoken for 5 seconds the AI invites someone: the person whose hand went up first, or with no hands up the connected person who has spoken least. The centre shows "AI invites someone in Ns" and then the invited person's countdown. If they do not reply, the next-quietest person is asked, and so on until somebody speaks.
- **Host panel.** Room code, End and evaluate, weak connections, every person's live scores, focus keywords, topic primer, all points raised.
- **Participant panel.** Own session (speaking time, turns, AI invitations, connection), own running scores, own points only.
- **After the end.** The room closes immediately and scoring continues in the background. The page shows the group summary, scores and transcript when ready: the host sees everyone's, a participant sees only their own.
- **Why it is quicker.** Mic, camera, and hand buttons update the screen first and tell the network after; the media token is requested while the connection is still being made; ending no longer waits for recordings to upload or for scoring to finish.


## Host moderation, reports, and privacy

- **The host is never transcribed.** The host moderates and is not scored, so the host's speech is neither recognised in the browser nor accepted by the server.
- **Moderation.** In the host's left panel, each person has Mute, Camera off, and Remove. Mute and Camera off are switched on the media server too, not just in the page, and they hold if the person reconnects. Removing asks for a reason, which the person sees; they cannot rejoin. Every action is saved (`ModerationEvent`) and printed in that person's report.
- **Removed people are still scored and reported** on what they said before removal. Their report states that they were removed, when, and why.
- **Who sees what.** The host sees every participant's live lines, scores and transcript. A participant sees only their own words and scores; no one else's are ever sent to their browser.
- **Reports (PDF).** Individual: the score, each criterion with its weight, score, points and explanation, the sum that produces the overall score, grade bands, feedback, host actions, and the person's transcript. Combined (host): overview of everyone, group summary, every individual breakdown, and the full transcript. Transcript PDF: the host's is everyone, a participant's is their own. Reports for someone with no captured speech say why, and are never blank.
- **After pulling this update run `npm run db:push`**: it adds the moderation table and the removal and camera-lock columns.


## Transcripts and scores: how they are produced, and what to check when they are missing

- **Participants see the host.** The host has a seat in every layout (marked "host"), with camera and voice, so participants can always see and hear them.
- **Every spoken line is acknowledged.** The server answers each line with "saved" or the reason it was not (no consent, discussion ended, and so on). A participant sees that reason in red under the controls; otherwise they see "Transcribing · N lines saved". Lines spoken before the room is joined are held and sent afterwards. Timing uses the server clock, so a wrong clock on a participant's computer cannot lose or misplace a line.
- **Test before joining.** The lobby has a "Test transcription" button that says what the browser heard, or why it heard nothing.
- **Audio fallback.** If a browser cannot transcribe (Firefox, Safari), keeps failing, or stays silent while the person is clearly talking for 10 seconds, the room switches to short audio clips (cut at pauses, silence is never sent) that Gemini turns into text. This needs `GEMINI_API_KEY`; clips are not stored, and the lobby says so. `AI_MAX_TRANSCRIBE_CALLS_PER_ROOM` (default 1500) caps the cost.
- **The host sees capture health** in the People list: lines transcribed per person, and a warning for anyone whose browser cannot transcribe or who has been heard speaking with no words captured.
- **Scoring without AI is fair.** With no AI analysis, a line is no longer discounted as "unverifiable" and relevance is not counted twice inside knowledge. A person who was heard speaking but not transcribed gets an Incomplete report that says so, with participation estimated from speaking time.
- **If scoring fails** the results screen now says why and the host gets a "Recalculate scores" button, instead of "Preparing…" forever. `/api/health` also reports whether the database matches this version (`"schema": "current"`); if it says `out-of-date`, run `npm run db:push`.


## Live transcript and speaking time (update)

- **Live captions.** While someone is speaking, the words so far appear in their own transcript panel and in the host's, marked "speaking now". They are not stored and go to nobody else. The saved line replaces the caption.
- **Timestamps.** Every line in the live panel shows time since the discussion started. The host can filter the panel by person and download the transcript so far; a participant downloads only their own.
- **Speaking time is the real length of each burst of voice**, credited when the burst ends (and when someone leaves). Previously one second was added at the start of each burst, so six lines could show as three seconds and distort participation.
- **Line timing.** A line now starts when the first word of the phrase was heard, not when the browser finished recognising it, so durations and timestamps are accurate.
- **Rejoining** reloads the newest 500 lines (it used to load the oldest 300).
- **PDF file names** include the person's name (`quorum-<meeting>-individual-<name>.pdf`), so a host can save every individual report and transcript side by side.


## Real-time transcription (second update)

- **Lines are sent within about half a second** of a phrase ending (previously 0.5-1.2 s of extra waiting, then a 0.4 s gap on every recogniser restart). A long speech is sent in pieces while the person is still talking.
- **`src/lib/speechCapture.ts`** turns the browser's recogniser events into lines. It removes the repeated words Android Chrome produces (earlier results re-sent, or one result growing and marked final each time), starts each line when the first word was heard, and is covered by `test/speechCapture.test.ts`.
- **A new recognition session starts immediately** when one ends. Nothing spoken during a restart is lost.
- **After a dropped connection** lines are held until the server has re-joined the room, and any line it rejected as "not joined" is sent again. Before, those words were lost.
- **The audio fallback no longer needs a Gemini key.** If the browser cannot transcribe, or speech is heard but nothing is saved (6 s at the start, 20 s later on), short audio clips are transcribed by Gemini, or, when there is no key, by the offline Whisper worker (`pip install -r scripts/stt/requirements.txt` and `scripts/stt/fetch-stt-model.sh`). The server tells each browser whether it can do this.
- Without a Gemini key **and** without Whisper, only Chrome/Edge speech recognition is available, and the room says so.

## Speed (third update)

- **Run it in production mode for real use.** `npm run dev` compiles each page the first time it is opened, so the first click on every page is slow by design. Use `npm run prod` (builds, then starts) for demos and sessions.
- **Database pool.** Pooled URLs (Supabase/Neon) were forced to `connection_limit=1`, so every query waited for the one before it. A long-running server now gets a pool of 10; serverless (Vercel) keeps 1. Set `connection_limit` in `DATABASE_URL` to override.
- **One user lookup, not several.** Each page, layout and API call checked the account in the database. It is now looked up once per request and remembered for 30 seconds (and forgotten when the profile changes).
- **Instant response on click.** Every main page has a loading screen that appears immediately; host action buttons show "Working…" and cannot be double-clicked.
- **Fewer and parallel queries** on the host dashboard and session page; each person's transcript is built once, not twice.
- **Live room.** The transcript list no longer re-renders on every clock tick; live score recalculation runs at most every 2.5 s.
- **Keep the database near the server.** A database in another country adds that round-trip to every query. Choose the same region as your server (and, if on Render's free plan, open the app a minute before a session, since it sleeps when idle).


## Floor etiquette, hand queue, host-away and automatic end

- **No interruptions.** While someone is speaking, nobody else can switch a microphone on (the button is disabled and the server refuses it as well). A person who is already live and talks over a speaker is asked to wait and the host is told; only the host mutes. The host is exempt from the block. The AI voice waits for a free floor and stops as soon as anyone starts talking.
- **Hand queue.** Raising a hand records the time. The host's panel shows the queue, first raised at the top, with how long each person has waited and a **Give floor** button (it waits for the current speaker to finish). The AI serves the queue first. Raising a hand again, toggling the mic or reconnecting never moves a person back. Speaking or being given the floor lowers the hand. Each person with a hand up sees their place.
- **Host loses connection.** The meeting does not end. After 10 seconds without the host the AI moderator takes over (even if the host had switched it off), the room sees a notice, and the moderator hands back when the host returns. The host's mute buttons and hand queue come back with them.
- **Automatic end.** The meeting ends when its scheduled duration is up, with the host connected or not. If the host ends it, every browser is closed at once, and a browser that reconnects afterwards is told the meeting is over. The media room is closed a few seconds later.
- **Camera.** There is no host control over a camera. The host can mute a microphone or remove someone.
- **Floor safety.** While speaking, the browser repeats "speaking" every 3 seconds. A floor with no report for 12 seconds is released, so a lost message can never lock the room.

## The 3D table layout

A fourth layout that draws the room as a 3D round table with an original cartoon character seated for every person. It is a pure view: it reads the same `seats`, `focusId`, `selfIndex` and centre content as the other layouts, opens no socket, makes no request and never touches audio or video, so choosing it changes nothing in the meeting or the backend.

- **Seating** uses the same `ringPositions` as the 2D round table, so everyone sees the same order and your own seat is nearest the camera. The ring grows with the head-count, for up to 40 people.
- **Focus.** When someone speaks, the camera glides to their character; when focus clears it returns to the overview. It uses the existing `FocusTracker` (a new speaker must keep talking for 0.4 s, focus is held for 1.5 s after they stop), so the camera can start moving up to about 0.65 s after someone begins to speak. With reduced motion the camera cuts instead of gliding.
- **Characters** are procedural and look the same on every screen, picked from the user id (never the name). They show speaking (a looped mouth and a soft beam; this is not lip-sync), raised hand, microphone off, invited (gold ring), away (see-through), connection quality and talk share. Camera video is not shown in 3D.
- **Labels** are real page text above each head. In rooms above 12 they get shorter, and above 24 only people who are speaking, invited, have a hand up, or are you get one. A hidden list for screen readers always names everyone.
- **Quality** steps down by itself (shadows, then detail) if frames are slow, and big rooms start on a cheaper tier.
- **Fallback.** With no WebGL, or if the graphics context is lost, the round table is shown with a notice. The saved layout choice is not changed.
- **Code** lives in `src/components/meeting/table3d/` (pure maths in `seat3d.ts`, tested in `test/seat3d.test.ts`). It is loaded only when picked, so three.js is not in the rest of the room. Dependencies: `three` 0.187.0 and `@react-three/fiber` 9.8.2 (exact versions).
