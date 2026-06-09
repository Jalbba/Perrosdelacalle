const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Render / proxies: necesario para que el rate limit vea la IP real
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(compression());
app.use(express.json({ limit: '32kb' }));

// Cabeceras de seguridad básicas (sin dependencia extra)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ---------------------------------------------------------------------------
// Anti-spam
// ---------------------------------------------------------------------------

// Sal aleatoria por arranque: las IPs se guardan hasheadas, nunca en claro
const IP_SALT = process.env.IP_SALT || crypto.randomBytes(16).toString('hex');
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

function ipHash(req) {
  return crypto.createHash('sha256').update(IP_SALT + (req.ip || '')).digest('hex').slice(0, 24);
}

// Token con HMAC + timestamp: el formulario debe estar abierto al menos 3
// segundos antes de enviar (frena bots tontos) y caduca a las 2 horas.
function issueToken() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(ts).digest('hex');
  return `${ts}.${sig}`;
}

function validToken(token) {
  if (typeof token !== 'string') return false;
  const [ts, sig] = token.split('.');
  if (!ts || !sig) return false;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(ts).digest('hex');
  let ok;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
  const age = Date.now() - Number(ts);
  return ok && age >= 3000 && age <= 2 * 60 * 60 * 1000;
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const createReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 4,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados reportes desde tu conexión. Probá de nuevo en un rato.' },
});

const commentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados comentarios. Probá de nuevo en un rato.' },
});

const voteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados votos. Probá de nuevo en un rato.' },
});

app.use('/api/', apiLimiter);

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const TYPES = new Set(['suelto', 'agresivo', 'jauria', 'abandono', 'perdido', 'otro']);

// Caja aproximada del departamento de Rocha (con margen)
const BOUNDS = { latMin: -35.1, latMax: -33.3, lngMin: -55.2, lngMax: -53.1 };

const DRIVE_RE = /^https:\/\/(drive\.google\.com|photos\.app\.goo\.gl|photos\.google\.com)\/\S+$/;

function cleanText(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length === 0 || t.length > max ? null : t;
}

function cleanDriveLink(s) {
  if (s == null || s === '') return null;
  if (typeof s !== 'string') return undefined; // inválido
  const t = s.trim();
  if (t === '') return null;
  return t.length <= 300 && DRIVE_RE.test(t) ? t : undefined;
}

function validCoords(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    lat >= BOUNDS.latMin && lat <= BOUNDS.latMax &&
    lng >= BOUNDS.lngMin && lng <= BOUNDS.lngMax
  );
}

function validDeviceId(id) {
  return typeof id === 'string' && /^[\w-]{8,64}$/.test(id);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get('/api/token', (req, res) => {
  res.json({ token: issueToken() });
});

const listReports = db.prepare(`
  SELECT r.id, r.type, r.description, r.lat, r.lng, r.occurred_at AS occurredAt,
         r.drive_link AS driveLink, r.created_at AS createdAt,
         (SELECT COUNT(*) FROM votes v WHERE v.report_id = r.id) AS votes,
         (SELECT COUNT(*) FROM comments c WHERE c.report_id = r.id) AS comments
  FROM reports r
  ORDER BY r.created_at DESC
  LIMIT 500
`);

app.get('/api/reports', (req, res) => {
  res.json({ reports: listReports.all() });
});

const getReport = db.prepare(`
  SELECT r.id, r.type, r.description, r.lat, r.lng, r.occurred_at AS occurredAt,
         r.drive_link AS driveLink, r.created_at AS createdAt,
         (SELECT COUNT(*) FROM votes v WHERE v.report_id = r.id) AS votes
  FROM reports r WHERE r.id = ?
`);
const getComments = db.prepare(`
  SELECT id, body, drive_link AS driveLink, created_at AS createdAt
  FROM comments WHERE report_id = ? ORDER BY created_at ASC
`);

app.get('/api/reports/:id', (req, res) => {
  const report = getReport.get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });
  report.commentList = getComments.all(report.id);
  res.json({ report });
});

const insertReport = db.prepare(`
  INSERT INTO reports (type, description, lat, lng, occurred_at, drive_link, ip_hash, device_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const reportsLastDay = db.prepare(`
  SELECT COUNT(*) AS n FROM reports
  WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')
`);

app.post('/api/reports', createReportLimiter, (req, res) => {
  const b = req.body || {};

  // Honeypot: los bots lo completan, los humanos no lo ven.
  // Respondemos "ok" para no darles pistas.
  if (b.website) return res.json({ ok: true, id: 0 });

  if (!validToken(b.token)) {
    return res.status(400).json({ error: 'Sesión vencida. Recargá la página e intentá de nuevo.' });
  }
  if (!TYPES.has(b.type)) return res.status(400).json({ error: 'Tipo de reporte inválido.' });

  const description = cleanText(b.description, 1000);
  if (!description || description.length < 10) {
    return res.status(400).json({ error: 'Contanos un poco más: la descripción necesita al menos 10 caracteres.' });
  }

  if (!validCoords(b.lat, b.lng)) {
    return res.status(400).json({ error: 'El punto del mapa tiene que estar dentro del departamento de Rocha.' });
  }

  const occurred = new Date(b.occurredAt || '');
  const now = Date.now();
  if (isNaN(occurred) || occurred.getTime() > now + 10 * 60 * 1000 || occurred.getTime() < now - 366 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'La fecha del hecho no es válida.' });
  }

  const driveLink = cleanDriveLink(b.driveLink);
  if (driveLink === undefined) {
    return res.status(400).json({ error: 'El link tiene que ser de Google Drive o Google Fotos (https://drive.google.com/... o https://photos.app.goo.gl/...).' });
  }

  if (!validDeviceId(b.deviceId)) return res.status(400).json({ error: 'Solicitud inválida.' });

  const hash = ipHash(req);
  if (reportsLastDay.get(hash).n >= 10) {
    return res.status(429).json({ error: 'Llegaste al máximo de reportes por día desde tu conexión.' });
  }

  const info = insertReport.run(b.type, description, b.lat, b.lng, occurred.toISOString(), driveLink, hash, b.deviceId);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

const insertComment = db.prepare(`
  INSERT INTO comments (report_id, body, drive_link, ip_hash) VALUES (?, ?, ?, ?)
`);

app.post('/api/reports/:id/comments', commentLimiter, (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });
  if (!validToken(b.token)) {
    return res.status(400).json({ error: 'Sesión vencida. Recargá la página e intentá de nuevo.' });
  }

  const report = getReport.get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });

  const body = cleanText(b.body, 600);
  if (!body || body.length < 3) return res.status(400).json({ error: 'El comentario es muy corto.' });

  const driveLink = cleanDriveLink(b.driveLink);
  if (driveLink === undefined) {
    return res.status(400).json({ error: 'El link tiene que ser de Google Drive o Google Fotos.' });
  }

  insertComment.run(report.id, body, driveLink, ipHash(req));
  res.status(201).json({ ok: true, comments: getComments.all(report.id) });
});

const findVote = db.prepare('SELECT 1 FROM votes WHERE report_id = ? AND device_id = ?');
const addVote = db.prepare('INSERT OR IGNORE INTO votes (report_id, device_id, ip_hash) VALUES (?, ?, ?)');
const removeVote = db.prepare('DELETE FROM votes WHERE report_id = ? AND device_id = ?');
const countVotes = db.prepare('SELECT COUNT(*) AS n FROM votes WHERE report_id = ?');

app.post('/api/reports/:id/vote', voteLimiter, (req, res) => {
  const b = req.body || {};
  if (!validDeviceId(b.deviceId)) return res.status(400).json({ error: 'Solicitud inválida.' });

  const report = getReport.get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });

  let voted;
  if (findVote.get(report.id, b.deviceId)) {
    removeVote.run(report.id, b.deviceId);
    voted = false;
  } else {
    addVote.run(report.id, b.deviceId, ipHash(req));
    voted = true;
  }
  res.json({ ok: true, voted, votes: countVotes.get(report.id).n });
});

// Moderación mínima: si configurás ADMIN_KEY en el entorno podés borrar
// reportes con: curl -X DELETE -H "X-Admin-Key: ..." https://tuapp/api/reports/123
app.delete('/api/reports/:id', (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.get('X-Admin-Key') !== key) return res.status(403).json({ error: 'No autorizado' });
  db.prepare('DELETE FROM comments WHERE report_id = ?').run(req.params.id);
  db.prepare('DELETE FROM votes WHERE report_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deleted: info.changes });
});

// ---------------------------------------------------------------------------
// Frontend estático
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.listen(PORT, () => {
  console.log(`🐾 Ojo al Perro escuchando en http://localhost:${PORT}`);
});
