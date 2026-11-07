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

Scores are out of 100. Formula version `1`. Weights:

| Part | Weight |
| --- | ---: |
| Topic relevance | 25% |
| Communication and clarity | 20% |
| Knowledge and content | 20% |
| Participation and initiative | 15% |
| Logical reasoning | 10% |
| Listening and engagement | 10% |

Each spoken line is labeled **Highly relevant**, **Relevant**, **Partially relevant**, or **Irrelevant**, with a short reason. The label uses the topic, earlier lines, and whether the person is responding to someone else.

The report also includes speaking time, contribution count, relevant and irrelevant lines, new ideas, constructive responses, missed opportunities, participation share, and average relevance. Feedback quotes real transcript lines. A line is stored as evidence only when it is relevant or highly relevant.

What is deliberately not scored: appearance, facial expression, gender, accent, and personality.

Special cases:

- No speech, and the microphone was working: participation is low and content is 0.
- Speech recognition unavailable, no media, or a disconnect with zero speech: the report is **Incomplete**. The overall score is empty. It is not a fake low content score.
- A muted microphone is not punished when the person already contributed enough (at least three contributions, or a speaking share close to a fair share).
- A missed invite counts only when the person has fewer than three contributions.
- Host mute and disconnects are recorded. They are not treated as a failed answer.

The host can correct a score. The correction requires a reason, and the original score stays visible.

## Language model

With `AI_API_KEY` empty, relevance, moderator lines, and the closing summary use the built-in lexical model. The transcript says **lexical model**. That is not a language model.

To use Groq's free tier, create a key at https://console.groq.com (no card) and put it in `.env`:

```
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=your-key
AI_MODEL=llama-3.3-70b-versatile
```

Restart `npm run dev` after changing `.env`. The same three variables work with OpenAI, or with a local Ollama server at `http://127.0.0.1:11434/v1` and any non-empty `AI_API_KEY`. The key stays on the server. This computer had no Groq, OpenAI, or Gemini key, so scoring stays lexical until you paste one.

If the model call fails or times out (20 seconds), that line falls back to the lexical label. Pending lines are finished lexically when the meeting is scored, so ending a meeting does not wait on the model.

## AI moderator

The moderator runs about every four seconds, one action at a time, and only while the host left it enabled:

- Prompt the room after a long silence.
- In AI-moderated mode, invite a quiet participant once.
- Ask a dominant speaker to leave room.
- Redirect the room when the recent lines are off topic.
- Give a closing summary near the end.

Default wording is a template. A language model rewrites it only when `AI_API_KEY` is set, and the template is kept if the rewrite is too long or drops the person's name.

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

`http://localhost` can use the camera and microphone. A phone on the same Wi-Fi cannot, until you create a certificate and use HTTPS:

```bash
npm run cert
npm run dev:https
```

Accept the browser's certificate warning. Windows may ask to allow `livekit-server.exe` through the firewall the first time someone joins from another device.

## Start again tomorrow

From the project folder:

```bash
npm install
npx prisma db push
npm run seed
npm run dev
```

Then open http://localhost:3000.

`npm install` and `db push` are only needed after a fresh checkout or a schema change. The SQLite file `prisma/dev.db` is already there, so tomorrow `npm run dev` is enough.

Demo accounts from the seed. Change `SEED_PASSWORD` in `.env` before anyone else uses this machine.

- Host: `host@quorum.local`
- Participant: `participant@quorum.local`
- Password: the value of `SEED_PASSWORD` (default `Quorum-demo-2026`)

A second participant needs another registered participant account, or a second browser profile. Video needs two browsers.

**Friday room check** (meeting `a100e11291`, code `316641`) was left live when the server stopped. Tomorrow it can still show as live until you open it and choose **End and score**.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Website, Socket.IO, and the media server |
| `npm run dev:https` | Same, with `certs/key.pem` and `certs/cert.pem` |
| `npm run cert` | Creates a local self-signed certificate |
| `npm run db:push` | Applies `prisma/schema.prisma` to SQLite |
| `npm run seed` | Creates the demo host and participant |
| `npm test` | Unit tests in `test/*.test.ts` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production Next.js build |
| `npm start` | Production process. Still the custom server, not `next start` |

## Environment

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file, default `file:./dev.db` next to the Prisma schema |
| `JWT_SECRET` | Signs the `quorum_token` session cookie (7 days, httpOnly) |
| `APP_URL` | Public origin, used in links |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Optional language model. Empty key means lexical scoring |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Password-reset and invite email. Empty SMTP shows the reset link on the page in development |
| `LIVEKIT_HOST` | Media server HTTP address, default `http://127.0.0.1:7880` |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Must match the key pair passed to the media server |
| `LIVEKIT_NODE_IP` | Address advertised to other devices. Blank uses the Wi-Fi address |
| `LIVEKIT_URL` | Optional public WebSocket URL for browsers |
| `STUN_URLS`, `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD` | ICE servers. Google STUN is the default. TURN is needed only for strict firewalls |
| `SEED_HOST_EMAIL`, `SEED_PARTICIPANT_EMAIL`, `SEED_PASSWORD` | Demo accounts |

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
bin/livekit-server.exe   Media server binary. Not committed
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
