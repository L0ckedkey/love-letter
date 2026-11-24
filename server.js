// Love Letter self-host server: static files + tiny realtime doc store (no dependencies).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || '/data';
const TTL_HOURS = +process.env.GAME_TTL_HOURS || 48;
const PUB = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'games.json');
const MAX_BODY = 300 * 1024;
const PATH_RE = /^games\/[A-Z0-9]{6}$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

const docs = new Map();   // path -> { data, at }
const leases = new Map(); // path -> { holder, until }
const subs = new Map();   // path -> Set<res>

/* ---------- persistence ---------- */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw)) if (PATH_RE.test(k)) docs.set(k, v);
    console.log(`loaded ${docs.size} game(s) from ${DB_FILE}`);
  } catch (e) { if (e.code !== 'ENOENT') console.warn('could not load data:', e.message); }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(docs)));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.warn('could not save data:', e.message); }
  }, 1500);
}
function prune() {
  const cutoff = Date.now() - TTL_HOURS * 3600e3;
  let n = 0;
  for (const [k, v] of docs) if ((v.at || 0) < cutoff) { docs.delete(k); n++; }
  if (n) { console.log(`pruned ${n} old game(s)`); save(); }
}

/* ---------- helpers ---------- */
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
    req.on('error', reject);
  });
}
function snapshot(p) { const d = docs.get(p); return d ? { exists: true, data: d.data } : { exists: false }; }
function broadcast(p) {
  const set = subs.get(p); if (!set) return;
  const msg = `data: ${JSON.stringify(snapshot(p))}\n\n`;
  for (const res of set) res.write(msg);
}

/* ---------- api ---------- */
async function api(req, res, url) {
  const route = url.pathname.replace(/^.*\/api\//, '');
  if (route === 'health') return send(res, 200, { ok: true, games: docs.size });
  const p = url.searchParams.get('path') || '';
  if (!PATH_RE.test(p)) return send(res, 400, { error: 'bad path' });

  if (route === 'doc') {
    if (req.method === 'GET') return send(res, 200, snapshot(p));
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'body must be an object' });
      docs.set(p, { data: body, at: Date.now() }); save(); broadcast(p);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') { docs.delete(p); save(); broadcast(p); return send(res, 200, { ok: true }); }
  }
  if (route === 'acquire' && req.method === 'POST') {
    const { holder, ttlMs } = await readBody(req);
    const now = Date.now(), l = leases.get(p);
    if (l && l.until > now && l.holder !== holder) return send(res, 200, { acquired: false, expiresAt: new Date(l.until).toISOString() });
    const until = now + Math.min(600000, Math.max(1000, +ttlMs || 30000));
    leases.set(p, { holder: String(holder), until });
    return send(res, 200, { acquired: true, holder, expiresAt: new Date(until).toISOString() });
  }
  if (route === 'sub' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 2000\ndata: ${JSON.stringify(snapshot(p))}\n\n`);
    if (!subs.has(p)) subs.set(p, new Set());
    subs.get(p).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); const s = subs.get(p); if (s) { s.delete(res); if (!s.size) subs.delete(p); } });
    return;
  }
  send(res, 404, { error: 'not found' });
}

/* ---------- static ---------- */
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.includes('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
    if (!e.status) console.error(e);
  }
});

load(); prune();
setInterval(prune, 3600e3);
setInterval(() => { const now = Date.now(); for (const [k, l] of leases) if (l.until < now) leases.delete(k); }, 60000);
server.listen(PORT, () => console.log(`Love Letter running on http://localhost:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  clearTimeout(saveTimer);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(Object.fromEntries(docs))); } catch (e) {}
  process.exit(0);
});
