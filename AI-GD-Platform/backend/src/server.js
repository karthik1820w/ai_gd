import './config.js';
import http from 'http';
import { attach } from './websocket/gateway.js'; import * as api from './routes/api.js'; import * as db from './modules/db.js'; import * as R from './modules/redis.js'; import * as Auth from './middleware/auth.js'; import * as F from './services/floorController.js';
await db.init(); await R.init(); await Auth.seed();
for (const s of await R.loadSnaps()) { F.restore(s); console.log('restored room', s.code, s.status); } // crash recovery
const server = http.createServer((req, res) => api.handle(req, res).catch(e => { console.error(e); res.writeHead(500); res.end('error'); }));
for (const row of await db.loadOpen()) if (!F.getRoom(row.s.code)) { F.fromDb(row); console.log('restored room from database', row.s.code); }
attach(server);
process.on('uncaughtException', e => console.error('uncaught', e)); process.on('unhandledRejection', e => console.error('unhandled', e));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
server.listen(process.env.PORT || 3000, () => console.log(`AI GD Platform on http://localhost:${process.env.PORT || 3000} | db:${db.enabled} redis:${R.enabled} media:${process.env.LIVEKIT_URL ? 'livekit' : 'mesh'}`));
