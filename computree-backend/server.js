import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8787);
const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), 'computree-events.json');
const ORIGIN = process.env.CORS_ORIGIN || '*';
const WRITE_TOKEN = process.env.WRITE_TOKEN || '';
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 1000);

app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: '256kb' }));

async function readEvents() {
  try {
    const text = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEvents(events) {
  await fs.writeFile(DATA_FILE, JSON.stringify(events.slice(-MAX_EVENTS), null, 2));
}

function sanitizeEvent(body) {
  const kind = String(body.kind || 'worldseed').slice(0, 64);
  const tree_hash = String(body.tree_hash || '').slice(0, 128);
  const payload = body.payload || {};

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be an object');
  }

  const raw = JSON.stringify(payload);
  if (raw.length > 200000) throw new Error('payload too large');

  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    kind,
    tree_hash,
    payload,
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'computree-backend' });
});

app.get('/events', async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const events = await readEvents();
  res.json(events.slice(-limit));
});

app.post('/events', async (req, res) => {
  if (WRITE_TOKEN) {
    const provided = req.header('x-write-token') || '';
    if (provided !== WRITE_TOKEN) return res.status(401).json({ error: 'bad write token' });
  }

  try {
    const event = sanitizeEvent(req.body || {});
    const events = await readEvents();
    events.push(event);
    await writeEvents(events);
    res.status(201).json(event);
  } catch (err) {
    res.status(400).json({ error: err.message || 'bad request' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Computree backend listening on http://0.0.0.0:${PORT}`);
});
