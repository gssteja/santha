const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SANTHA_API_KEY;
const APPS_DIR = path.join(__dirname, 'public', 'apps');
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(APPS_DIR, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, _file, cb) => cb(null, 'app.apk'),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/vnd.android.package-archive' || file.originalname.endsWith('.apk')) {
      cb(null, true);
    } else {
      cb(new Error('APK files only'));
    }
  },
});

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function readMeta(appDir, name) {
  const metaPath = path.join(appDir, 'meta.json');
  return fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    : { name, description: '' };
}

// List apps
app.get('/api/apps', (_req, res) => {
  if (!fs.existsSync(APPS_DIR)) return res.json([]);
  const apps = fs.readdirSync(APPS_DIR)
    .filter(d => fs.statSync(path.join(APPS_DIR, d)).isDirectory())
    .map(name => {
      const appDir = path.join(APPS_DIR, name);
      const meta = readMeta(appDir, name);
      const hasApk = fs.existsSync(path.join(appDir, 'app.apk'));
      const hasPwa = fs.existsSync(path.join(appDir, 'index.html'));
      return {
        ...meta,
        id: name,
        type: hasApk ? 'apk' : 'pwa',
        url: hasApk ? `/apps/${name}/app.apk` : `/apps/${name}/`,
        size: hasApk ? fs.statSync(path.join(appDir, 'app.apk')).size : null,
      };
    });
  res.json(apps);
});

// Upload APK — POST /api/apk/:id (multipart/form-data, field: apk)
app.post('/api/apk/:id', requireApiKey, (req, res, next) => {
  const id = req.params.id;
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'invalid id' });
  next();
}, apkUpload.single('apk'), (req, res) => {
  const id = req.params.id;
  if (req.body.meta) {
    try {
      const meta = JSON.parse(req.body.meta);
      fs.writeFileSync(path.join(APPS_DIR, id, 'meta.json'), JSON.stringify(meta, null, 2));
    } catch {}
  }
  res.json({ ok: true, url: `/apps/${id}/app.apk` });
});

// Deploy PWA/static app — POST /api/deploy { id, meta, files: { "index.html": "...", ... } }
app.post('/api/deploy', requireApiKey, (req, res) => {
  const { id, meta, files } = req.body;
  if (!id || !files) return res.status(400).json({ error: 'id and files required' });
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'invalid id' });

  const appDir = path.join(APPS_DIR, id);
  fs.mkdirSync(appDir, { recursive: true });

  for (const [filename, content] of Object.entries(files)) {
    const safePath = path.join(appDir, filename);
    if (!safePath.startsWith(appDir + path.sep) && safePath !== appDir) {
      return res.status(400).json({ error: `invalid filename: ${filename}` });
    }
    fs.mkdirSync(path.dirname(safePath), { recursive: true });
    fs.writeFileSync(safePath, content, 'utf8');
  }

  if (meta) fs.writeFileSync(path.join(appDir, 'meta.json'), JSON.stringify(meta, null, 2));
  res.json({ ok: true, url: `/apps/${id}/` });
});

// ── Workout sync ──────────────────────────────────────────────────────────────

const WORKOUT_FILE = path.join(DATA_DIR, 'workouts.json');

function readWorkouts() {
  if (!fs.existsSync(WORKOUT_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(WORKOUT_FILE, 'utf8')); } catch { return []; }
}

function writeWorkouts(records) {
  fs.writeFileSync(WORKOUT_FILE, JSON.stringify(records, null, 2));
}

// GET /api/workouts — full history
app.get('/api/workouts', (_req, res) => {
  res.json(readWorkouts());
});

// POST /api/workouts/sync — merge incoming records (client pushes, server merges by id)
app.post('/api/workouts/sync', (req, res) => {
  const incoming = req.body;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'expected array' });
  const existing = readWorkouts();
  const byId = new Map(existing.map(r => [r.id, r]));
  for (const record of incoming) {
    if (record.id) byId.set(record.id, record);
  }
  const merged = [...byId.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  writeWorkouts(merged);
  res.json({ ok: true, count: merged.length });
});

// DELETE /api/workouts/:id
app.delete('/api/workouts/:id', (req, res) => {
  const records = readWorkouts().filter(r => r.id !== req.params.id);
  writeWorkouts(records);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────

// Delete app
app.delete('/api/apps/:id', requireApiKey, (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'invalid id' });
  const appDir = path.join(APPS_DIR, id);
  if (!fs.existsSync(appDir)) return res.status(404).json({ error: 'not found' });
  fs.rmSync(appDir, { recursive: true });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Santha AppStore running on port ${PORT}`);
  if (!API_KEY) console.warn('WARNING: SANTHA_API_KEY not set — deploy endpoint is locked out');
});
