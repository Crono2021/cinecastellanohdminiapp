/* eslint-disable */
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// In-memory micro cache
const microCache = new Map();
const MC_TTL_MS = 60 * 1000; // 60s
function mcGet(key){ const v = microCache.get(key); if(!v) return null; if(Date.now()-v.t>MC_TTL_MS){ microCache.delete(key); return null;} return v.d; }
function mcSet(key, data){ microCache.set(key, {t:Date.now(), d:data}); }
function mcDelPrefix(prefix){
  try{
    for (const k of microCache.keys()){
      if (String(k).startsWith(prefix)) microCache.delete(k);
    }
  }catch(_){ }
}

// Per-user recommendations cache (kept separate from microCache)
const recCache = new Map();
const REC_TTL_MS = 15 * 60 * 1000; // 15 min
function recGet(userId){
  const v = recCache.get(String(userId));
  if (!v) return null;
  if (Date.now() - v.t > REC_TTL_MS){ recCache.delete(String(userId)); return null; }
  return v.d;
}
function recSet(userId, data){ recCache.set(String(userId), { t: Date.now(), d: data }); }
function recDel(userId){ try{ recCache.delete(String(userId)); }catch(_){ } }
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Config ---
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cchd-admin-token-cambialo';
const PORT = process.env.PORT || 3000;

// --- Helpers: normalize titles for accent-insensitive letter filtering/sorting ---
function normalizeForLetters(input){
  // Remove accent marks, but keep Ñ/ñ as a distinct letter.
  let s = String(input || '').trim();
  if (!s) return '';
  s = s.replace(/ñ/g, '__ENYE__').replace(/Ñ/g, '__ENYE__');
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/__ENYE__/g, 'Ñ');
  return s.toUpperCase();
}

function firstBucketLetter(title){
  const t = normalizeForLetters(title);
  if (!t) return '#';
  const ch = t[0];
  // A-Z -> that letter, everything else -> '#'
  return (ch >= 'A' && ch <= 'Z') ? ch : '#';
}

if (!TMDB_API_KEY) {
  console.warn('[AVISO] TMDB_API_KEY no está definido. Ponlo en .env');
}

// --- DB (persistencia opcional vía DB_PATH) ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(DB_PATH);

// --- Auth (sessions) ---
// For Railway/Reverse proxies: trust proxy so secure cookies work behind HTTPS.
app.set('trust proxy', 1);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.dirname(DB_PATH) }),
  secret: process.env.SESSION_SECRET || 'cchd-session-secret-cambialo',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  }
}));



// --- SQLite performance tweaks (safe) ---
db.serialize(() => {
  try {
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA synchronous=NORMAL");
    db.run("PRAGMA temp_store=MEMORY");
    db.run("PRAGMA cache_size=-16000"); // ~16MB cache
    db.run("PRAGMA foreign_keys=ON");
  } catch(_){}
  // Indices to speed up common lookups and filters
  db.run("CREATE INDEX IF NOT EXISTS idx_movies_tmdb ON movies(tmdb_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title)");
  db.run("CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year)");
  db.run("CREATE INDEX IF NOT EXISTS idx_series_tmdb ON series(tmdb_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_series_name ON series(name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_series_year ON series(first_air_year)");
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS movies (
    tmdb_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    year INTEGER,
    link TEXT NOT NULL,
    genre_ids TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS series (
    tmdb_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    first_air_year INTEGER,
    link TEXT NOT NULL,
    payload TEXT,
    genre_ids TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Global daily views (shared by all users)
  // date: YYYY-MM-DD (server local time)
  // type: 'movie' | 'tv'
  db.run(`CREATE TABLE IF NOT EXISTS views_daily (
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (date, type, tmdb_id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_views_daily_date ON views_daily(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_views_daily_date_count ON views_daily(date, count)`);

  // --- Users & Ratings ---
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, tmdb_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ratings_user ON ratings(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ratings_tmdb ON ratings(tmdb_id)`);

  db.run(`CREATE TABLE IF NOT EXISTS pending (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, tmdb_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pending_user ON pending(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pending_tmdb ON pending(tmdb_id)`);

  db.run(`CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tmdb_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, tmdb_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_favorites_tmdb ON favorites(tmdb_id)`);

// --- Collections (public) ---
db.run(`CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  cover_image TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_collections_created ON collections(created_at)`);

db.run(`CREATE TABLE IF NOT EXISTS collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  tmdb_id INTEGER NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(collection_id, tmdb_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_collection_items_tmdb ON collection_items(tmdb_id)`);

});

// Lightweight schema migrations for older DBs

// We must check PRAGMA table_info first to avoid "duplicate column name" crashes.
function ensureColumn(table, column, typeSql){
  db.all(`PRAGMA table_info(${table})`, (err, rows) => {
    if (err || !Array.isArray(rows)) return;
    const exists = rows.some(r => r && r.name === column);
    if (exists) return;
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`, () => {});
  });
}

db.serialize(() => {
  ensureColumn('movies', 'genre_ids', 'TEXT');
  ensureColumn('series', 'genre_ids', 'TEXT');
  // Payload for Telegram deep-linking (start=<payload>)
  ensureColumn('series', 'payload', 'TEXT');
});

function ymdLocal(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function getSessionUser(req){
  const u = req?.session?.user;
  if (!u || !u.id) return null;
  return u;
}

function requireAuth(req, res, next){
  const u = getSessionUser(req);
  if (!u) return res.status(401).json({ error: 'NO_AUTH' });
  next();
}


function normalizeLink(link){
  try{
    if (!link) return link;
    // Force https for t.me
    if (link.startsWith('http://t.me/')) return 'https' + link.slice(4);
    if (link.startsWith('https://t.me/')) return link;

    // Convert tg:// or tg:resolve?domain=...&post=...&thread=...
    if (link.startsWith('tg://') || link.startsWith('tg:')){
      const raw = link.replace(/^tg:\/\//,'tg:');
      const qIdx = raw.indexOf('?');
      const qs = new URLSearchParams(raw.slice(qIdx+1));
      const domain = qs.get('domain');
      const post = qs.get('post');
      const thread = qs.get('thread');
      if (domain && post){
        return `https://t.me/${domain}/${post}` + (thread ? `?thread=${thread}` : '');
      }
    }
    return link;
  }catch(_){ return link; }
}

function buildTelegramForPayload(payload){
  const p = String(payload || '').trim();
  if (!p) return null;
  const enc = encodeURIComponent(p);
  return {
    app: `tg://resolve?domain=videoclubpacobot&start=${enc}`,
    web: `https://t.me/videoclubpacobot?start=${enc}`
  };
}

// --- TMDB micro-cache (to avoid repeated calls when filtering by genre) ---
const tmdbMetaCache = new Map();
const TMDB_META_TTL_MS = 6 * 60 * 60 * 1000; // 6h
function metaGet(key){
  const v = tmdbMetaCache.get(key);
  if (!v) return null;
  if (Date.now() - v.t > TMDB_META_TTL_MS){ tmdbMetaCache.delete(key); return null; }
  return v.d;
}
function metaSet(key, data){ tmdbMetaCache.set(key, { t: Date.now(), d: data }); }

async function getMovieMetaFast(tmdbId){
  const key = `m:${tmdbId}`;
  const cached = metaGet(key);
  if (cached) return cached;
  const d = await getTmdbMovieDetails(tmdbId);
  const meta = {
    poster_path: d?.poster_path || null,
    backdrop_path: d?.backdrop_path || null,
    genres: Array.isArray(d?.genres) ? d.genres : [],
  };
  metaSet(key, meta);
  return meta;
}

async function getTvMetaFast(tmdbId){
  const key = `t:${tmdbId}`;
  const cached = metaGet(key);
  if (cached) return cached;
  const d = await getTmdbTvDetails(tmdbId);
  const meta = {
    poster_path: d?.poster_path || null,
    backdrop_path: d?.backdrop_path || null,
    genres: Array.isArray(d?.genres) ? d.genres : [],
  };
  metaSet(key, meta);
  return meta;
}

function encodeGenreIds(genres){
  const ids = (genres || []).map(g => Number(g && g.id)).filter(n => Number.isFinite(n) && n > 0);
  // comma delimited with leading/trailing comma to allow LIKE matching: ",16,35,"
  return ids.length ? (',' + ids.join(',') + ',') : ',';
}

async function ensureGenreIdsForRow(row){
  // Returns { genre_ids: string, meta: {poster_path, genres} } with lazy DB update
  const isTv = row.type === 'tv';
  const tmdbId = Number(row.tmdb_id);
  if (!tmdbId) return { genre_ids: ',', meta: { poster_path: null, backdrop_path: null, genres: [] } };

  if (row.genre_ids && String(row.genre_ids).trim()){
    try{
      const meta = isTv ? await getTvMetaFast(tmdbId) : await getMovieMetaFast(tmdbId);
      return { genre_ids: row.genre_ids, meta };
    }catch(_){
      return { genre_ids: row.genre_ids, meta: { poster_path: null, backdrop_path: null, genres: [] } };
    }
  }

  try{
    const meta = isTv ? await getTvMetaFast(tmdbId) : await getMovieMetaFast(tmdbId);
    const enc = encodeGenreIds(meta.genres);
    await new Promise((resolve) => {
      const sql = isTv
        ? 'UPDATE series SET genre_ids = ? WHERE tmdb_id = ?'
        : 'UPDATE movies SET genre_ids = ? WHERE tmdb_id = ?';
      db.run(sql, [enc, tmdbId], ()=> resolve());
    });
    return { genre_ids: enc, meta };
  }catch(_){
    return { genre_ids: ',', meta: { poster_path: null, backdrop_path: null, genres: [] } };
  }
}

// --- Backfill genre_ids in background (best-effort) ---
// This makes genre filtering fast and progressively more complete.
async function backfillGenreIdsInBackground(){
  try{
    const movieRows = await new Promise((resolve, reject)=>{
      db.all(
        "SELECT tmdb_id FROM movies WHERE genre_ids IS NULL OR TRIM(genre_ids) = '' OR TRIM(genre_ids) = ','",
        [],
        (err, rows)=> err ? reject(err) : resolve(rows||[])
      );
    });

    const tvRows = await new Promise((resolve, reject)=>{
      db.all(
        "SELECT tmdb_id FROM series WHERE genre_ids IS NULL OR TRIM(genre_ids) = '' OR TRIM(genre_ids) = ','",
        [],
        (err, rows)=> err ? reject(err) : resolve(rows||[])
      );
    });

    const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
    const CONCURRENCY = 4;

    async function runQueue(rows, type){
      let idx = 0;
      async function worker(){
        while (true){
          const i = idx++;
          if (i >= rows.length) break;
          const tmdbId = Number(rows[i].tmdb_id);
          if (!tmdbId) continue;
          try{
            const meta = (type === 'tv') ? await getTvMetaFast(tmdbId) : await getMovieMetaFast(tmdbId);
            const enc = encodeGenreIds(meta.genres);
            await new Promise((resolve)=>{
              const sql = (type === 'tv')
                ? 'UPDATE series SET genre_ids = ? WHERE tmdb_id = ?'
                : 'UPDATE movies SET genre_ids = ? WHERE tmdb_id = ?';
              db.run(sql, [enc, tmdbId], ()=> resolve());
            });
          }catch(_){
            // ignore
          }
          // Gentle pacing for TMDB
          await sleep(50);
        }
      }

      const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, ()=> worker());
      await Promise.all(workers);
    }

    await runQueue(movieRows, 'movie');
    await runQueue(tvRows, 'tv');
  }catch(e){
    console.error('backfillGenreIdsInBackground error:', e);
  }
}
// --- Helpers ---
function adminGuard(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

async function tmdbSearchTv(name, year){
  const url = 'https://api.themoviedb.org/3/search/tv';
  const { data } = await axios.get(url, {
    params: {
      api_key: TMDB_API_KEY,
      query: name,
      include_adult: true,
      first_air_date_year: year || undefined,
      language: 'es-ES'
    }
  });
  const r = (data.results || [])[0];
  return r ? { id: r.id, name: r.name, first_air_date: r.first_air_date } : null;
}

async function getTmdbTvDetails(tmdbId){
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}`;
  const creditsUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/credits`;
  const [detailsResp, creditsResp] = await Promise.all([
    axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } }),
    axios.get(creditsUrl, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } })
  ]);
  const d = detailsResp.data;
  const c = creditsResp.data;
  return {
    id: d.id,
    name: d.name,
    original_name: d.original_name,
    overview: d.overview,
    poster_path: d.poster_path,
    backdrop_path: d.backdrop_path,
    first_air_date: d.first_air_date,
    genres: d.genres,
    number_of_seasons: d.number_of_seasons,
    number_of_episodes: d.number_of_episodes,
    vote_average: d.vote_average,
    cast: (c.cast || []).slice(0, 10).map(x=>({ id:x.id, name:x.name, character:x.character }))
  };
}

async function tmdbSearchMovie(title, year) {
  const url = 'https://api.themoviedb.org/3/search/movie';
  const { data } = await axios.get(url, {
    params: {
      api_key: TMDB_API_KEY,
      query: title,
      include_adult: true,
      year: year || undefined,
      language: 'es-ES'
    }
  });
  if (!data.results || data.results.length === 0) return null;
  if (year) {
    const exact = data.results.find(r => (r.release_date || '').startsWith(String(year)));
    if (exact) return exact;
  }
  return data.results[0];
}


async function tmdbDiscoverMovies(params){
  const url = 'https://api.themoviedb.org/3/discover/movie';
  const resp = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES', ...params } });
  return resp.data;
}

async function tmdbGetMovieDetails(tmdbId) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}`;
  const creditsUrl = `https://api.themoviedb.org/3/movie/${tmdbId}/credits`;
  const [detailsResp, creditsResp] = await Promise.all([
    axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } }),
    axios.get(creditsUrl, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } })
  ]);
  const d = detailsResp.data;
  const c = creditsResp.data;
  return {
    id: d.id,
    title: d.title,
    original_title: d.original_title,
    overview: d.overview,
    poster_path: d.poster_path,
    backdrop_path: d.backdrop_path,
    release_date: d.release_date,
    genres: d.genres,
    runtime: d.runtime,
    vote_average: d.vote_average,
    cast: (c.cast || []).slice(0, 10),
    crew: (c.crew || []).slice(0, 10)
  };
}

// Movie details + credits + release_dates (single request via append_to_response)
async function tmdbGetMovieDetailsWithReleaseDates(tmdbId){
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}`;
  const { data: d } = await axios.get(url, {
    params: {
      api_key: TMDB_API_KEY,
      language: 'es-ES',
      append_to_response: 'credits,release_dates'
    }
  });
  const c = d.credits || {};
  return {
    id: d.id,
    title: d.title,
    original_title: d.original_title,
    overview: d.overview,
    poster_path: d.poster_path,
    backdrop_path: d.backdrop_path,
    release_date: d.release_date,
    genres: d.genres,
    runtime: d.runtime,
    vote_average: d.vote_average,
    cast: (c.cast || []).slice(0, 10),
    crew: (c.crew || []).slice(0, 10),
    release_dates: d.release_dates || null,
  };
}

let _genresCache = { data: null, ts: 0 };
async function tmdbGetGenres() {
  const now = Date.now();
  if (_genresCache.data && (now - _genresCache.ts) < 60*60*1000) {
    return _genresCache.data;
  }
  const url = `https://api.themoviedb.org/3/genre/movie/list`;
  const { data } = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
  _genresCache = { data: data.genres || [], ts: Date.now() };
  return _genresCache.data;
}

async function tmdbSearchPersonByName(name) {
  const url = `https://api.themoviedb.org/3/search/person`;
  const { data } = await axios.get(url, { params: { api_key: TMDB_API_KEY, query: name, language: 'es-ES' } });
  if (!data.results || data.results.length === 0) return null;
  return data.results[0];
}

// --- API ---
app.use(express.static(path.join(__dirname, 'public')));

// Series catalog (same layout as películas)
app.get('/series', (req, res) => {
  // Serve the same home UI; JS will detect /series and switch to TV mode
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --------------------
// Auth
// --------------------
app.get('/api/auth/me', (req, res) => {
  const u = getSessionUser(req);
  if (!u) return res.json({ ok: true, user: null });
  res.json({ ok: true, user: { id: u.id, username: u.username } });
});

app.post('/api/auth/register', async (req, res) => {
  try{
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'USERNAME_INVALID' });
    if (password.length < 6 || password.length > 72) return res.status(400).json({ error: 'PASSWORD_INVALID' });
    const hash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], function(err){
      if (err){
        if (String(err.message||'').toLowerCase().includes('unique')) return res.status(409).json({ error: 'USERNAME_TAKEN' });
        return res.status(500).json({ error: 'DB_ERROR' });
      }
      req.session.user = { id: this.lastID, username };
      res.json({ ok: true, user: { id: this.lastID, username } });
    });
  }catch(_){
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'BAD_REQUEST' });
  db.get('SELECT id, username, password_hash FROM users WHERE username = ?', [username], async (err, row) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    if (!row) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    try{
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      req.session.user = { id: row.id, username: row.username };
      res.json({ ok: true, user: { id: row.id, username: row.username } });
    }catch(_){
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --------------------
// Ratings & Recomendaciones (movies)
// --------------------

app.get('/api/ratings/:tmdb_id', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.params.tmdb_id);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  db.get('SELECT rating FROM ratings WHERE user_id = ? AND tmdb_id = ?', [user.id, tmdbId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    res.json({ ok: true, rating: row ? Number(row.rating) : null });
  });
});

app.post('/api/ratings', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.body?.tmdb_id);
  const rating = Number(req.body?.rating);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) return res.status(400).json({ error: 'BAD_RATING' });
  const sql = `INSERT INTO ratings (user_id, tmdb_id, rating) VALUES (?, ?, ?)
               ON CONFLICT(user_id, tmdb_id) DO UPDATE SET rating = excluded.rating, updated_at = datetime('now')`;
  db.run(sql, [user.id, tmdbId, Math.round(rating)], (err) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    recDel(user.id);
    mcDelPrefix('appTopRated:');
    res.json({ ok: true });
  });
});

app.delete('/api/ratings/:tmdb_id', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.params.tmdb_id);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  db.run('DELETE FROM ratings WHERE user_id = ? AND tmdb_id = ?', [user.id, tmdbId], (err) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    recDel(user.id);
    mcDelPrefix('appTopRated:');
    res.json({ ok: true });
  });
});

app.get('/api/my-ratings', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(60, Math.max(1, parseInt(req.query.pageSize || '30', 10)));
  const offset = (page - 1) * pageSize;

  db.get('SELECT COUNT(1) as c FROM ratings WHERE user_id = ?', [user.id], (err, rowCount) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    const total = Number(rowCount?.c || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const sql = `SELECT r.tmdb_id, r.rating, r.updated_at,
                       m.title as title, m.year as year, m.link as link
                FROM ratings r
                LEFT JOIN movies m ON m.tmdb_id = r.tmdb_id
                WHERE r.user_id = ?
                ORDER BY r.updated_at DESC
                LIMIT ? OFFSET ?`;
    db.all(sql, [user.id, pageSize, offset], async (err2, rows) => {
      if (err2) return res.status(500).json({ error: 'DB_ERROR' });
      const out = [];
      for (const r of (rows||[])){
        let meta = { poster_path: null };
        try{ meta = await getMovieMetaFast(r.tmdb_id); }catch(_){ }
        out.push({
          type: 'movie',
          tmdb_id: r.tmdb_id,
          title: r.title || '',
          year: r.year || null,
          link: r.link || null,
          poster_path: meta.poster_path || null,
          user_rating: Number(r.rating)
        });
      }
      res.json({ ok: true, page, pageSize, totalPages, totalResults: total, results: out });
    });
  });
});

// --------------------
// Pendientes (watch later)
// --------------------

app.get('/api/pending/:tmdb_id', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.params.tmdb_id);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  db.get('SELECT 1 as ok FROM pending WHERE user_id = ? AND tmdb_id = ?', [user.id, tmdbId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    res.json({ ok: true, pending: !!row });
  });
});

app.post('/api/pending', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.body?.tmdb_id);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  const sql = `INSERT INTO pending (user_id, tmdb_id) VALUES (?, ?)
               ON CONFLICT(user_id, tmdb_id) DO NOTHING`;
  db.run(sql, [user.id, tmdbId], (err) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    res.json({ ok: true });
  });
});

app.delete('/api/pending/:tmdb_id', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.params.tmdb_id);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  db.run('DELETE FROM pending WHERE user_id = ? AND tmdb_id = ?', [user.id, tmdbId], (err) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    res.json({ ok: true });
  });
});

app.get('/api/pending', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(60, Math.max(1, parseInt(req.query.pageSize || '30', 10)));
  const offset = (page - 1) * pageSize;

  db.get('SELECT COUNT(1) as c FROM pending WHERE user_id = ?', [user.id], (err, rowCount) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    const total = Number(rowCount?.c || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const sql = `SELECT p.tmdb_id, p.created_at,
                       m.title as title, m.year as year, m.link as link
                FROM pending p
                LEFT JOIN movies m ON m.tmdb_id = p.tmdb_id
                WHERE p.user_id = ?
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?`;
    db.all(sql, [user.id, pageSize, offset], async (err2, rows) => {
      if (err2) return res.status(500).json({ error: 'DB_ERROR' });
      const out = [];
      for (const r of (rows||[])) {
        let meta = { poster_path: null, title: r.title || '' };
        try{ meta = await getMovieMetaFast(r.tmdb_id); }catch(_){ }
        out.push({
          type: 'movie',
          tmdb_id: r.tmdb_id,
          title: r.title || meta.title || '',
          year: r.year || (meta.release_date ? String(meta.release_date).slice(0,4) : null),
          link: r.link || null,
          poster_path: meta.poster_path || null
        });
      }
      res.json({ ok: true, page, pageSize, totalPages, totalResults: total, results: out, items: out });
    });
  });
});

// --------------------
// Favoritos
// --------------------

app.get('/api/favorites/:tmdb_id', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.params.tmdb_id);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  db.get('SELECT 1 as ok FROM favorites WHERE user_id = ? AND tmdb_id = ?', [user.id, tmdbId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    res.json({ ok: true, favorite: !!row });
  });
});

app.post('/api/favorites', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.body?.tmdb_id);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  const sql = `INSERT INTO favorites (user_id, tmdb_id) VALUES (?, ?)
               ON CONFLICT(user_id, tmdb_id) DO NOTHING`;
  db.run(sql, [user.id, tmdbId], (err) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    res.json({ ok: true });
  });
});

app.delete('/api/favorites/:tmdb_id', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const tmdbId = Number(req.params.tmdb_id);
  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: 'BAD_ID' });
  db.run('DELETE FROM favorites WHERE user_id = ? AND tmdb_id = ?', [user.id, tmdbId], (err) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    res.json({ ok: true });
  });
});

app.get('/api/favorites', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(60, Math.max(1, parseInt(req.query.pageSize || '30', 10)));
  const offset = (page - 1) * pageSize;

  db.get('SELECT COUNT(1) as c FROM favorites WHERE user_id = ?', [user.id], (err, rowCount) => {
    if (err) return res.status(500).json({ error: 'DB_ERROR' });
    const total = Number(rowCount?.c || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const sql = `SELECT f.tmdb_id, f.created_at,
                       m.title as title, m.year as year, m.link as link
                FROM favorites f
                LEFT JOIN movies m ON m.tmdb_id = f.tmdb_id
                WHERE f.user_id = ?
                ORDER BY f.created_at DESC
                LIMIT ? OFFSET ?`;
    db.all(sql, [user.id, pageSize, offset], async (err2, rows) => {
      if (err2) return res.status(500).json({ error: 'DB_ERROR' });
      const out = [];
      for (const r of (rows||[])) {
        let meta = { poster_path: null, title: r.title || '' };
        try{ meta = await getMovieMetaFast(r.tmdb_id); }catch(_){ }
        out.push({
          type: 'movie',
          tmdb_id: r.tmdb_id,
          title: r.title || meta.title || '',
          year: r.year || (meta.release_date ? String(meta.release_date).slice(0,4) : null),
          link: r.link || null,
          poster_path: meta.poster_path || null
        });
      }
      res.json({ ok: true, page, pageSize, totalPages, totalResults: total, results: out, items: out });
    });
  });
});

async function fetchTmdbRecommendationsForMovie(tmdbId){
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}/recommendations`;
  const { data } = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES', page: 1 } });
  return Array.isArray(data?.results) ? data.results : [];
}

app.get('/api/recommended', requireAuth, async (req, res) => {
  const user = getSessionUser(req);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(60, Math.max(1, parseInt(req.query.pageSize || '30', 10)));

  const cached = recGet(user.id);
  if (cached){
    const start = (page - 1) * pageSize;
    const slice = cached.results.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(cached.results.length / pageSize));
    return res.json({ ok: true, page, pageSize, totalPages, totalResults: cached.results.length, results: slice });
  }

  try{
    const rated = await new Promise((resolve) => {
      db.all('SELECT tmdb_id, rating FROM ratings WHERE user_id = ? AND rating >= 8 ORDER BY updated_at DESC LIMIT 10', [user.id], (e, rows) => resolve(rows || []));
    });
    const ratedIds = new Set(rated.map(r => Number(r.tmdb_id)));
    if (!rated.length) return res.json({ ok:true, page, pageSize, totalPages: 1, totalResults: 0, results: [] });

    const pool = new Map();
    for (const r of rated.slice(0, 5)){
      const recs = await fetchTmdbRecommendationsForMovie(r.tmdb_id);
      for (const it of recs){
        const id = Number(it?.id);
        if (!id || ratedIds.has(id)) continue;
        const base = (it?.popularity || 0) * 0.02 + (it?.vote_average || 0);
        const bump = Number(r.rating) >= 10 ? 2 : (Number(r.rating) >= 9 ? 1 : 0);
        const prev = pool.get(id) || 0;
        pool.set(id, prev + base + bump + 3);
      }
    }

    const idsSorted = Array.from(pool.entries()).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    const results = [];
    for (const id of idsSorted.slice(0, 240)){
      try{
        const d = await getTmdbMovieDetails(id);
        results.push({
          type: 'movie',
          tmdb_id: id,
          title: d?.title || '',
          year: d?.release_date ? Number(String(d.release_date).slice(0,4)) : null,
          link: null,
          poster_path: d?.poster_path || null
        });
      }catch(_){ }
    }

    recSet(user.id, { results });
    const start = (page - 1) * pageSize;
    const slice = results.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
    res.json({ ok:true, page, pageSize, totalPages, totalResults: results.length, results: slice });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'RECS_ERROR' });
  }
});

// GET /api/genres
app.get('/api/genres', async (req, res) => {
  try {
    const genres = await tmdbGetGenres();
    res.json(genres);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron obtener los géneros' });
  }
});

// --- Global Top (shared across all users) ---
// POST /api/view  { tmdb_id, type }
app.post('/api/view', (req, res) => {
  try{
    const tmdb_id = Number(req.body && (req.body.tmdb_id ?? req.body.id));
    const typeRaw = String((req.body && req.body.type) || 'movie').toLowerCase();
    const type = (typeRaw === 'tv' || typeRaw === 'series') ? 'tv' : 'movie';
    if (!tmdb_id || !Number.isFinite(tmdb_id)) return res.status(400).json({ error: 'tmdb_id inválido' });
    const date = ymdLocal();

    db.run(
      `INSERT INTO views_daily(date, type, tmdb_id, count, updated_at)
       VALUES(?,?,?,?,datetime('now'))
       ON CONFLICT(date, type, tmdb_id) DO UPDATE SET
         count = count + 1,
         updated_at = datetime('now')`,
      [date, type, tmdb_id, 1],
      (err) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'No se pudo registrar la vista' });
        }
        // Invalidate micro-cache keys related to today's top
        try{ microCache.delete(`top:${date}:10`); }catch(_){ }
        res.json({ ok: true });
      }
    );
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'No se pudo registrar la vista' });
  }
});

// GET /api/top?date=YYYY-MM-DD&limit=10
app.get('/api/top', (req, res) => {
  const date = String(req.query.date || ymdLocal());
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
  const key = `top:${date}:${limit}`;
  const cached = mcGet(key);
  if (cached) return res.json(cached);

  db.all(
    `SELECT type, tmdb_id, count
     FROM views_daily
     WHERE date = ?
     ORDER BY count DESC, updated_at DESC
     LIMIT ?`,
    [date, limit],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'No se pudo obtener el top' });
      }
      const out = (rows || []).map(r => ({ type: r.type, id: r.tmdb_id, tmdb_id: r.tmdb_id, count: r.count }));
      mcSet(key, out);
      res.json(out);
    }
  );
});

// GET /api/app-top-rated?limit=10
// Devuelve las películas mejor valoradas *dentro de la app* (media de ratings de usuarios).
// Orden: media desc, nº de votos desc. Limitado a 50.
async function handleAppTopRated(req, res){
  try{
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
    const key = `appTopRated:${limit}`;
    const cached = mcGet(key);
    if (cached) return res.json(cached);

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id,
                AVG(rating) AS avg_rating,
                COUNT(*)     AS votes
           FROM ratings
          WHERE rating IS NOT NULL
          GROUP BY tmdb_id
          HAVING votes >= 1
          ORDER BY avg_rating DESC, votes DESC
          LIMIT ?`,
        [limit],
        (err, r) => err ? reject(err) : resolve(r || [])
      );
    });

    if (!rows.length){
      mcSet(key, []);
      return res.json([]);
    }

    // Enrich con datos TMDB (título/poster/año). 10-50 llamadas máx.
    const items = await Promise.all(rows.map(async (r) => {
      const tmdbId = Number(r.tmdb_id);
      try{
        const d = await getTmdbMovieDetails(tmdbId);
        return {
          tmdb_id: d.id,
          id: d.id,
          type: 'movie',
          title: d.title,
          year: d.release_date ? String(d.release_date).slice(0,4) : '',
          poster_path: d.poster_path,
          avg_rating: Number(r.avg_rating || 0),
          votes: Number(r.votes || 0),
        };
      }catch(_){
        return {
          tmdb_id: tmdbId,
          id: tmdbId,
          type: 'movie',
          title: `#${tmdbId}`,
          year: '',
          poster_path: null,
          avg_rating: Number(r.avg_rating || 0),
          votes: Number(r.votes || 0),
        };
      }
    }));

    mcSet(key, items);
    res.json(items);
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el top de la app' });
  }
}

// Canonical endpoint
app.get('/api/app-top-rated', handleAppTopRated);
// Aliases (front/back compatibility with previous UI code)
app.get('/api/top-rated-app', handleAppTopRated);
app.get('/api/appTopRated', handleAppTopRated);
app.get('/api/best-rated', handleAppTopRated);


// GET /api/movies/by-actor?name=...&page=1&pageSize=24[&q=][&genre=]
app.get('/api/movies/by-actor', async (req, res) => {
  try {
    const { name, q, genre, page = 1, pageSize = 24 } = req.query;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ error: 'Falta name' });
    }

    // Find person in TMDB
    const person = await tmdbSearchPersonByName(String(name).trim());
    if (!person) return res.json({ total: 0, page: Number(page), pageSize: Number(pageSize) || 24, items: [] });

    // Get movie credits and build tmdb_id set
    const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/movie_credits`;
    const { data } = await axios.get(creditsUrl, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
    const ids = Array.from(new Set([...(data.cast||[]), ...(data.crew||[])].map(m => m.id)));
    if (ids.length === 0) return res.json({ total: 0, page: Number(page), pageSize: Number(pageSize) || 24, items: [] });

    // Intersect with our DB and apply optional title filter 'q'
    let where = [];
    let params = [];

    const limited = ids.slice(0, 900); // SQLite params safety
    const placeholders = limited.map(()=>'?').join(',');
    where.push(`tmdb_id IN (${placeholders})`);
    params.push(...limited);

    if (q) {
      where.push('LOWER(title) LIKE ?');
      params.push('%' + String(q).toLowerCase() + '%');
    }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const limit = Math.min(parseInt(pageSize), 60) || 24;
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    const total = await new Promise((resolve, reject) => {
      const sql = `SELECT COUNT(*) as c FROM movies ${whereSql}`;
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row.c);
      });
    });

    if (!total) {
      return res.json({ total: 0, page: Number(page), pageSize: limit, items: [] });
    }

    const rows = await new Promise((resolve, reject) => {
      const sql = `SELECT tmdb_id, title, year, link FROM movies ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      db.all(sql, [...params, limit, offset], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    // Enrich to allow optional genre filter (consistent with /api/movies)
    const details = await Promise.all(rows.map(r => tmdbGetMovieDetails(r.tmdb_id)));
    let items = rows.map((r, i) => ({ ...r, poster_path: details[i]?.poster_path || null, _details: details[i] || null }));

    if (genre) {
      items = items.filter(it => it._details?.genres?.some(g => String(g.id) == String(genre)));
    }

    items = items.map(({ _details, ...rest }) => rest);

    res.json({ total, page: Number(page), pageSize: limit, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo buscar por actor' });
  }
});
app.get('/api/series/by-actor', async (req, res) => {
  try {
    const { name, q, genre, page = 1, pageSize = 24 } = req.query;
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ error: 'Falta name' });
    }

    // Find person in TMDB
    const person = await tmdbSearchPersonByName(String(name).trim());
    if (!person) return res.json({ total: 0, page: Number(page), pageSize: Number(pageSize) || 24, items: [] });

    // Get movie credits and build tmdb_id set
    const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/tv_credits`;
    const { data } = await axios.get(creditsUrl, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
    const ids = Array.from(new Set([...(data.cast||[]), ...(data.crew||[])].map(m => m.id)));
    if (ids.length === 0) return res.json({ total: 0, page: Number(page), pageSize: Number(pageSize) || 24, items: [] });

    // Intersect with our DB and apply optional title filter 'q'
    let where = [];
    let params = [];

    const limited = ids.slice(0, 900); // SQLite params safety
    const placeholders = limited.map(()=>'?').join(',');
    where.push(`tmdb_id IN (${placeholders})`);
    params.push(...limited);

    if (q) {
      where.push('LOWER(title) LIKE ?');
      params.push('%' + String(q).toLowerCase() + '%');
    }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const limit = Math.min(parseInt(pageSize), 60) || 24;
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    const total = await new Promise((resolve, reject) => {
      const sql = `SELECT COUNT(*) as c FROM series ${whereSql}`;
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row.c);
      });
    });

    if (!total) {
      return res.json({ total: 0, page: Number(page), pageSize: limit, items: [] });
    }

    const rows = await new Promise((resolve, reject) => {
      const sql = `SELECT tmdb_id, title, year, link FROM series ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      db.all(sql, [...params, limit, offset], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    // Enrich to allow optional genre filter (consistent with /api/movies)
    const details = await Promise.all(rows.map(r => tmdbGetMovieDetails(r.tmdb_id)));
    let items = rows.map((r, i) => ({ ...r, poster_path: details[i]?.poster_path || null, _details: details[i] || null }));

    if (genre) {
      items = items.filter(it => it._details?.genres?.some(g => String(g.id) == String(genre)));
    }

    items = items.map(({ _details, ...rest }) => rest);

    res.json({ total, page: Number(page), pageSize: limit, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo buscar por actor' });
  }
});



// GET /api/movies/search-lite?q=...&limit=20  (for live search in collections)
app.get('/api/movies/search-lite', (req, res) => {
  try{
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 50);
    if (!q) return res.json([]);
    db.all(
      `SELECT tmdb_id, title, year FROM movies WHERE LOWER(title) LIKE ? ORDER BY title ASC LIMIT ?`,
      ['%' + q + '%', limit],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB_ERROR' });
        res.json(rows || []);
      }
    );
  }catch(_){
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/movies – q, genre, actor, page, pageSize (enriquecido con poster_path)

// GET /api/catalog -- unified movies + series
app.get('/api/catalog', async (req, res) => {
  // micro-cache wrapper
  const key = req.originalUrl;
  const cached = mcGet(key);
  if (cached) return res.json(cached);

  // Intercept res.json to store in cache
  const _json = res.json.bind(res);
  res.json = (payload) => { try{ mcSet(key, payload); }catch(_){
  } return _json(payload); };

  try {
    const { q, genre, type, page = 1, pageSize = 24 } = req.query;
    const typeFilter = (String(type||'').toLowerCase()==='tv' ? 'tv' : (String(type||'').toLowerCase()==='movie' ? 'movie' : ''));
    const limit = Math.min(parseInt(pageSize) || 24, 100);
    const pageNum = Math.max(1, parseInt(page) || 1);

    const qLike = q ? '%' + String(q).toLowerCase() + '%' : null;

    const totalMovies = await new Promise((resolve, reject) => {
      const where = qLike ? "WHERE LOWER(title) LIKE ?" : "";
      const params = qLike ? [qLike] : [];
      db.get(`SELECT COUNT(*) as c FROM movies ${where}`, params, (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.c : 0);
      });
    });

    const totalSeries = await new Promise((resolve, reject) => {
      const where = qLike ? "WHERE LOWER(name) LIKE ?" : "";
      const params = qLike ? [qLike] : [];
      db.get(`SELECT COUNT(*) as c FROM series ${where}`, params, (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.c : 0);
      });
    });

    let total = Number(totalMovies) + Number(totalSeries);

    // Fetch a generous window from both, order by rowid desc to approximate recency
    const movies = await new Promise((resolve, reject) => {
      const where = qLike ? "WHERE LOWER(title) LIKE ?" : "";
      const params = qLike ? [qLike] : [];
      db.all(`SELECT tmdb_id, title, year, link, genre_ids, created_at FROM movies ${where} ORDER BY rowid DESC`, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    const series = await new Promise((resolve, reject) => {
      const where = qLike ? "WHERE LOWER(name) LIKE ?" : "";
      const params = qLike ? [qLike] : [];
      db.all(`SELECT tmdb_id, name AS title, first_air_year AS year, link, genre_ids, created_at FROM series ${where} ORDER BY rowid DESC`, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    let items = [
      ...movies.map(m => ({ type:'movie', ...m })),
      ...series.map(s => ({ type:'tv', ...s })),
    ];
    // Apply explicit type filter if requested (tv/movie)
    if (typeFilter){
      items = items.filter(it => it.type === typeFilter);
      total = items.length;
    }


    // Sort by created_at desc (fallback to tmdb_id desc)
    items.sort((a,b)=>{
      const da = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dbb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (dbb !== da) return dbb - da;
      return (b.tmdb_id||0) - (a.tmdb_id||0);
    });

    const wantedGenre = genre ? String(genre) : '';

    // If genre filter is requested, filter BEFORE paginating so it works across the full catalog.
    let filteredItems = items;
    if (wantedGenre){
      const out = [];
      for (const it of items){
        const { genre_ids } = await ensureGenreIdsForRow({ ...it, genre_ids: it.genre_ids });
        if (String(genre_ids || '').includes(`,${wantedGenre},`)) out.push(it);
      }
      filteredItems = out;
      total = filteredItems.length;
    }

    // Enrich only the current page to keep it fast
    const startIdx = (pageNum - 1) * limit;
    const pageItems = filteredItems.slice(startIdx, startIdx + limit);

    const enriched = await Promise.all(pageItems.map(async (it) => {
      try{
        if (it.type === 'tv'){
          const meta = await getTvMetaFast(it.tmdb_id);
          return { ...it, poster_path: meta?.poster_path || null };
        }else{
          const meta = await getMovieMetaFast(it.tmdb_id);
          return { ...it, poster_path: meta?.poster_path || null };
        }
      }catch(_){
        return { ...it, poster_path: null };
      }
    }));

    const totalPages = Math.max(1, Math.ceil(total / limit));
    res.json({ total, totalPages, page: pageNum, pageSize: limit, items: enriched });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el catálogo' });
  }
});

// GET /api/catalog/by-letter?letter=A|B|...|Z|#&page=1&pageSize=30
// Returns ONLY movies, sorted alphabetically (accent-insensitive).
app.get('/api/catalog/by-letter', async (req, res) => {
  const key = req.originalUrl;
  const cached = mcGet(key);
  if (cached) return res.json(cached);

  const _json = res.json.bind(res);
  res.json = (payload) => { try{ mcSet(key, payload); }catch(_){ } return _json(payload); };

  try{
    const letterRaw = String(req.query.letter || '').trim();
    const letter = (letterRaw === '#' ? '#' : normalizeForLetters(letterRaw).slice(0,1));
    const pageNum = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.pageSize) || 30, 100);

    // Load minimal movie fields (fast), then filter/sort in JS.
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT tmdb_id, title, year, link, created_at FROM movies', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    const filtered = rows.filter(r => {
      const b = firstBucketLetter(r.title);
      return letter === '#' ? b === '#' : b === letter;
    });

    // Alphabetical sort by normalized title (accent-insensitive), then year, then tmdb_id.
    filtered.sort((a,b) => {
      const na = normalizeForLetters(a.title);
      const nb = normalizeForLetters(b.title);
      if (na < nb) return -1;
      if (na > nb) return 1;
      const ya = Number(a.year) || 0;
      const yb = Number(b.year) || 0;
      if (ya !== yb) return ya - yb;
      return (a.tmdb_id||0) - (b.tmdb_id||0);
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(pageNum, totalPages);

    const startIdx = (safePage - 1) * limit;
    const pageItems = filtered.slice(startIdx, startIdx + limit);

    // Enrich posters only for the current page.
    const enriched = await Promise.all(pageItems.map(async (it) => {
      try{
        const d = await getTmdbMovieDetails(it.tmdb_id);
        return { type: 'movie', ...it, poster_path: d?.poster_path || null };
      }catch(_){
        return { type: 'movie', ...it, poster_path: null };
      }
    }));

    res.json({ total, page: safePage, pageSize: limit, totalPages, letter, items: enriched });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'No se pudo filtrar el catálogo por letra' });
  }
});



app.get('/api/series', async (req, res) => {
  try {
    const { q, genre, actor, page = 1, pageSize = 24 } = req.query;

    let where = [];
    let params = [];

    if (q) {
      where.push('LOWER(name) LIKE ?');
      params.push('%' + String(q).toLowerCase() + '%');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as c FROM series ${whereSql}`, params, (err, row) => {
        if (err) return reject(err);
        resolve(row.c);
      });
    });

    const limit = Math.min(parseInt(pageSize), 60) || 24;
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    const rows = await new Promise((resolve, reject) => {
      db.all(`SELECT tmdb_id, name as title, first_air_year as year, link, payload FROM series ${whereSql} LIMIT ? OFFSET ?`, [...params, limit, offset], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });

    const details = await Promise.all(rows.map(r => getTmdbTvDetails(r.tmdb_id)));

    let items = rows.map((r, i) => ({
      ...r,
      type: 'tv',
      telegram: buildTelegramForPayload(r.payload) || null,
      poster_path: details[i]?.poster_path || null,
      backdrop_path: details[i]?.backdrop_path || null,
      _details: details[i] || null
    }));

    if (actor) {
      const person = await tmdbSearchPersonByName(actor);
      if (person) {
        const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/tv_credits`;
        const { data } = await axios.get(creditsUrl, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
        const ids = new Set((data.cast || []).concat(data.crew || []).map(m => m.id));
        items = items.filter(it => ids.has(it.tmdb_id));
      } else {
        items = [];
      }
    }

    if (genre) {
      items = items.filter(it => it._details?.genres?.some(g => String(g.id) == String(genre)));
    }

    items = items.map(({ _details, ...rest }) => rest);

    res.json({ total: count, page: Number(page), pageSize: limit, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el listado de series' });
  }
});

// GET /api/series/top-rated?limit=10
// Devuelve las series mejor valoradas según TMDB (vote_average + vote_count) dentro del catálogo local.
app.get('/api/series/top-rated', async (req, res) => {
  const key = req.originalUrl;
  const cached = mcGet(key);
  if (cached) return res.json(cached);

  const _json = res.json.bind(res);
  res.json = (payload) => { try{ mcSet(key, payload); }catch(_){ } return _json(payload); };

  try{
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit) || 10));

    const rows = await new Promise((resolve, reject) => {
      db.all(`SELECT tmdb_id, name AS title, first_air_year AS year, link, payload FROM series`, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    if (!rows.length) return res.json({ items: [] });

    // Fetch details from TMDB
    const details = await Promise.all(rows.map(r => getTmdbTvDetails(r.tmdb_id).catch(_=>null)));

    let items = rows.map((r, i) => {
      const d = details[i] || {};
      const vote_average = Number(d.vote_average || 0);
      const vote_count = Number(d.vote_count || 0);
      // Simple score: primary vote_average, tie-breaker vote_count
      const score = vote_average * 100000 + vote_count;
      return {
        type: 'tv',
        tmdb_id: r.tmdb_id,
        id: r.tmdb_id,
        title: r.title,
        year: r.year || (d.first_air_date ? String(d.first_air_date).slice(0,4) : ''),
        poster_path: d.poster_path || null,
        backdrop_path: d.backdrop_path || null,
        vote_average,
        vote_count,
        telegram: buildTelegramForPayload(r.payload) || null,
        payload: r.payload || null,
        _score: score
      };
    });

    items.sort((a,b) => (b._score||0) - (a._score||0));
    items = items.slice(0, limit).map(({_score, ...rest}) => rest);

    res.json({ items });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el top de series' });
  }
});





// GET /api/series?page=1&pageSize=24&q=...&random=1
// Devuelve series del catálogo (tabla series) con posters desde TMDB.
app.get('/api/series', async (req, res) => {
  try{
    const { q, random, page = 1, pageSize = 24 } = req.query;
    const p = Math.max(1, parseInt(page) || 1);
    const ps = Math.max(1, Math.min(60, parseInt(pageSize) || 24));

    let where = [];
    let params = [];

    if (q){
      where.push('LOWER(name) LIKE ?');
      params.push('%' + String(q).toLowerCase() + '%');
    }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const orderSql = (String(random||'') === '1' || String(random||'').toLowerCase()==='true')
      ? "ORDER BY RANDOM()"
      : "ORDER BY datetime(created_at) DESC";

    const total = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) AS c FROM series ${whereSql}`, params, (err, row) => {
        if (err) return reject(err);
        resolve((row && row.c) || 0);
      });
    });

    const offset = (p - 1) * ps;

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, name, first_air_year, payload, created_at
         FROM series
         ${whereSql}
         ${orderSql}
         LIMIT ? OFFSET ?`,
        [...params, ps, offset],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    if (!rows.length) return res.json({ total, page: p, pageSize: ps, items: [] });

    // Enrich with TMDB details (poster/backdrop). Keep it resilient.
    const details = await Promise.all(rows.map(r => getTmdbTvDetails(r.tmdb_id).catch(_=>null)));

    const items = rows.map((r, i) => {
      const d = details[i] || {};
      return {
        type: 'tv',
        id: r.tmdb_id,
        tmdb_id: r.tmdb_id,
        title: r.name || d.name || d.title || '',
        year: r.first_air_year || (d.first_air_date ? String(d.first_air_date).slice(0,4) : ''),
        poster_path: d.poster_path || null,
        backdrop_path: d.backdrop_path || null,
        payload: r.payload || null,
        telegram: buildTelegramForPayload(r.payload) || null,
        created_at: r.created_at
      };
    });

    res.json({ total, page: p, pageSize: ps, items });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el catálogo de series' });
  }
});



app.get('/api/movies', async (req, res) => {
  try {
    const { q, genre, actor, random, page = 1, pageSize = 24 } = req.query;

    let where = [];
    let params = [];

    if (q) {
      where.push('LOWER(title) LIKE ?');
      params.push('%' + String(q).toLowerCase() + '%');
    }

    const wantedGenre = genre ? String(genre) : '';
    if (wantedGenre){
      // Use cached genre_ids for speed. A background backfill progressively completes the cache.
      where.push('genre_ids LIKE ?');
      params.push(`%,${wantedGenre},%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const limit = Math.min(parseInt(pageSize), 60) || 24;
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const offset = (pageNum - 1) * limit;

    const total = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as c FROM movies ${whereSql}`,
        params,
        (err, row) => err ? reject(err) : resolve(row ? row.c : 0)
      );
    });

    const orderSql = String(random || '') === '1'
      ? 'ORDER BY RANDOM()'
      : 'ORDER BY datetime(created_at) DESC, rowid DESC';

    const baseRows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, title, year, link, genre_ids, created_at FROM movies ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });

    let actorIds = null;
    if (actor) {
      const person = await tmdbSearchPersonByName(actor);
      if (person) {
        const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/movie_credits`;
        const { data } = await axios.get(creditsUrl, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
        actorIds = new Set((data.cast || []).concat(data.crew || []).map(m => m && m.id).filter(Boolean));
      } else {
        actorIds = new Set();
      }
    }

    // If actor filter is used, we must filter client-side since actor credits come from TMDB.
    // (Genre filter already applied via SQL when possible.)
    let slice = baseRows;
    let totalOut = Number(total);
    if (actorIds){
      slice = baseRows.filter(r => actorIds.has(Number(r.tmdb_id)));
      totalOut = slice.length; // best-effort for this page; exact total would require scanning all
    }

    const totalPages = Math.max(1, Math.ceil(totalOut / limit));

    // Enrich with poster_path (cached)
    const items = await Promise.all(slice.map(async (r) => {
      try{
        const meta = await getMovieMetaFast(r.tmdb_id);
        // opportunistically backfill genre_ids on rows that still miss it
        if (!r.genre_ids || String(r.genre_ids).trim()==='' || String(r.genre_ids).trim()===','){
          const enc = encodeGenreIds(meta.genres);
          try{ db.run('UPDATE movies SET genre_ids = ? WHERE tmdb_id = ?', [enc, Number(r.tmdb_id)]); }catch(_){ }
        }
        return {
          tmdb_id: r.tmdb_id,
          title: r.title,
          year: r.year,
          link: r.link,
          type: 'movie',
          poster_path: meta.poster_path,
          backdrop_path: meta.backdrop_path,
        };
      }catch(_){
        return { tmdb_id: r.tmdb_id, title: r.title, year: r.year, link: r.link, type:'movie', poster_path:null, backdrop_path:null };
      }
    }));

    res.json({ total: totalOut, totalPages, page: pageNum, pageSize: limit, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el listado' });
  }
});

// GET /api/movie/:id

// Minimal TV details endpoint to avoid type mixups
app.get('/api/tv/:id', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.id);

    // Try DB 'series' table for link, but always fetch TMDB TV details
    const seriesRow = await new Promise((resolve, reject) => {
      db.get('SELECT tmdb_id, name, first_air_year, link, payload FROM series WHERE tmdb_id = ?', [tmdbId], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

    const d = await getTmdbTvDetails(tmdbId);
    // Return same shape fields server already uses in TV branch of /api/movie/:id
    return res.json({
      id: d.id,
      title: d.name, // keep 'title' for UI
      original_title: d.original_name,
      overview: d.overview,
      poster_path: d.poster_path,
      backdrop_path: d.backdrop_path,
      release_date: d.first_air_date,
      genres: d.genres,
      runtime: null,
      vote_average: d.vote_average,
      cast: d.cast,
      link: seriesRow ? normalizeLink(seriesRow.link) : null,
      payload: seriesRow ? (seriesRow.payload || null) : null,
      telegram: seriesRow ? (buildTelegramForPayload(seriesRow.payload) || null) : null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron obtener los detalles (tv)' });
  }
});

app.get('/api/movie/:id', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.id);

    const movieRow = await new Promise((resolve, reject) => {
      db.get('SELECT tmdb_id, title, year, link FROM movies WHERE tmdb_id = ?', [tmdbId], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

    if (movieRow){
      const d = await getTmdbMovieDetails(tmdbId);
      return res.json({ ...d, link: normalizeLink(movieRow.link) });
    }

    const seriesRow = await new Promise((resolve, reject) => {
      db.get('SELECT tmdb_id, name as title, first_air_year as year, link, payload FROM series WHERE tmdb_id = ?', [tmdbId], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

    if (seriesRow){
      const d = await getTmdbTvDetails(tmdbId);
      return res.json({
        id: d.id,
        title: d.name,
        overview: d.overview,
        poster_path: d.poster_path,
        backdrop_path: d.backdrop_path,
        release_date: d.first_air_date,
        genres: d.genres,
        runtime: null,
        vote_average: d.vote_average,
        cast: d.cast,
        link: normalizeLink(seriesRow.link),
        payload: seriesRow.payload || null,
        telegram: buildTelegramForPayload(seriesRow.payload) || null
      });
    }

    const d = await getTmdbMovieDetails(tmdbId);
    res.json({ ...d, link: null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron obtener los detalles' });
  }
});

async function getTmdbMovieDetails(tmdbId){
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}`;
  const creditsUrl = `https://api.themoviedb.org/3/movie/${tmdbId}/credits`;
  const [detailsResp, creditsResp] = await Promise.all([
    axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } }),
    axios.get(creditsUrl, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } })
  ]);
  const d = detailsResp.data;
  const c = creditsResp.data;
  return {
    id: d.id,
    title: d.title,
    original_title: d.original_title,
    overview: d.overview,
    poster_path: d.poster_path,
    backdrop_path: d.backdrop_path,
    release_date: d.release_date,
    genres: d.genres,
    runtime: d.runtime,
    vote_average: d.vote_average,
    cast: (c.cast || []).slice(0, 10).map(x=>({ id:x.id, name:x.name, character:x.character }))
  };
}

// POST /api/admin/add


// GET /api/estrenos?limit=30
// Devuelve SOLO películas del catálogo que hayan tenido estreno (cine) en España (ES) en los últimos 365 días.
// Importante: se ordenan por *añadidas al catálogo* (created_at desc) para que los estrenos recién añadidos
// no queden atrás.
app.get('/api/estrenos', async (req, res) => {
  const key = req.originalUrl;
  const cached = mcGet(key);
  if (cached) return res.json(cached);
  const _json = res.json.bind(res);
  res.json = (payload) => { try{ mcSet(key, payload); }catch(_){ } return _json(payload); };

  try{
    const limit = Math.min(parseInt(req.query.limit) || 30, 60);

    // Cogemos una ventana de películas añadidas recientemente (por si hay muchas entradas)
    // y filtramos por estrenos en ES en el último año.
    const recentCatalog = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, link, created_at FROM movies ORDER BY datetime(created_at) DESC LIMIT 500`,
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });

    const today = new Date();
    const lte = ymdLocal(today);
    const from = new Date(today.getTime() - 365*24*60*60*1000);
    const gte = ymdLocal(from);
    const gteTs = new Date(gte + 'T00:00:00').getTime();
    const lteTs = new Date(lte + 'T23:59:59').getTime();

    function pickSpainTheatricalDate(releaseDatesObj){
      try{
        const results = releaseDatesObj?.results || [];
        const es = results.find(x => x && x.iso_3166_1 === 'ES');
        const dates = (es?.release_dates || [])
          .filter(x => x && (x.type === 3) && x.release_date)
          .map(x => String(x.release_date).slice(0,10));
        if (!dates.length) return null;
        // fecha de estreno (primera fecha de estreno en cines)
        dates.sort();
        return dates[0];
      }catch(_){
        return null;
      }
    }

    const collected = [];
    for (const row of recentCatalog){
      if (collected.length >= limit) break;
      const id = Number(row.tmdb_id);
      if (!id) continue;

      // Detalles + release_dates en una sola llamada
      const meta = await tmdbGetMovieDetailsWithReleaseDates(id);
      const estreno_es = pickSpainTheatricalDate(meta.release_dates) || (meta.release_date ? String(meta.release_date).slice(0,10) : null);
      if (!estreno_es) continue;
      const ts = new Date(estreno_es + 'T00:00:00').getTime();
      if (!(ts >= gteTs && ts <= lteTs)) continue;

      collected.push({
        type: 'movie',
        tmdb_id: id,
        id,
        title: meta.title,
        year: (meta.release_date || '').slice(0,4) ? Number(String(meta.release_date).slice(0,4)) : null,
        poster_path: meta.poster_path,
        overview: meta.overview,
        cast: (meta.cast || []).slice(0, 10).map(x=>({ id:x.id, name:x.name, character:x.character })),
        link: row.link,
        estreno_es,
        created_at: row.created_at,
      });
    }

    res.json({ items: collected, gte, lte });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'No se pudieron obtener los estrenos' });
  }
});

// GET /api/estrenos-tv?limit=30
// Series cuyo primer episodio (first_air_date) cae en el último año (aprox), dentro del catálogo.
app.get('/api/estrenos-tv', async (req, res) => {
  const key = req.originalUrl;
  const cached = mcGet(key);
  if (cached) return res.json(cached);
  const _json = res.json.bind(res);
  res.json = (payload) => { try{ mcSet(key, payload); }catch(_){ } return _json(payload); };

  try{
    const limit = Math.min(parseInt(req.query.limit) || 30, 60);

    const recentCatalog = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, link, created_at, payload FROM series ORDER BY datetime(created_at) DESC LIMIT 800`,
        [],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    const today = new Date();
    const lte = ymdLocal(today);
    const from = new Date(today.getTime() - 365*24*60*60*1000);
    const gte = ymdLocal(from);
    const gteTs = new Date(gte + 'T00:00:00').getTime();
    const lteTs = new Date(lte + 'T23:59:59').getTime();

    const collected = [];
    for (const row of recentCatalog){
      if (collected.length >= limit) break;
      const id = Number(row.tmdb_id);
      if (!id) continue;

      const meta = await getTmdbTvDetails(id);
      const estreno = meta.first_air_date ? String(meta.first_air_date).slice(0,10) : null;
      if (!estreno) continue;
      const ts = new Date(estreno + 'T00:00:00').getTime();
      if (!(ts >= gteTs && ts <= lteTs)) continue;

      collected.push({
        type: 'tv',
        tmdb_id: id,
        id,
        title: meta.name,
        year: (meta.first_air_date || '').slice(0,4) ? Number(String(meta.first_air_date).slice(0,4)) : null,
        poster_path: meta.poster_path,
        overview: meta.overview,
        cast: (meta.cast || []).slice(0, 10).map(x=>({ id:x.id, name:x.name, character:x.character })),
        link: row.link,
        payload: row.payload,
        estreno,
        created_at: row.created_at,
      });
    }

    res.json({ items: collected, gte, lte });
  }catch(e){
    console.error(e);
    res.status(500).json({ error: 'No se pudieron obtener los estrenos de series' });
  }
});



app.post('/api/admin/add', adminGuard, async (req, res) => {
  try {
    const { title, year, link, tmdbId, type } = req.body;
    if (!link) return res.status(400).json({ error: 'Falta link' });
    const isTv = (type === 'tv');

    if (isTv){
      let tv_id = tmdbId;
      let realName = title;
      let realYear = year;
      // Asegurar nombre/año desde TMDB cuando se aporta solo tmdbId
      if (tv_id && (!realName || !realYear)) {
        try {
          const _d = await getTmdbTvDetails(tv_id);
          if (!realName) realName = (_d && (_d.name || _d.original_name)) || realName;
          if (!realYear) {
            const fa = _d && _d.first_air_date ? _d.first_air_date.slice(0,4) : null;
            realYear = fa ? parseInt(fa) : realYear || null;
          }
        } catch(_e) { /* continuar aunque TMDB falle */ }
      }


      if (!tv_id && title){
        const t = await tmdbSearchTv(title, year ? parseInt(year) : undefined);
        if (!t) return res.status(404).json({ error: 'No se encontró la serie en TMDB' });
        tv_id = t.id;
        realName = t.name;
        realYear = t.first_air_date ? parseInt(t.first_air_date.slice(0,4)) : year || null;
      }

      if (!tv_id) return res.status(400).json({ error: 'Falta tmdbId o title para series' });

      await new Promise((resolve, reject)=>{
        const sql = 'INSERT OR REPLACE INTO series (tmdb_id, name, first_air_year, link, genre_ids) VALUES (?, ?, ?, ?, ?)';
        // attempt to store genres from TMDB (best-effort)
        db.run(sql, [ tv_id, realName || '', realYear || null, normalizeLink(link), null ], (err)=> err?reject(err):resolve());
      });

      const d = await getTmdbTvDetails(tv_id);
      try{
        const enc = encodeGenreIds(d?.genres || []);
        db.run('UPDATE series SET genre_ids = ? WHERE tmdb_id = ?', [enc, tv_id], ()=>{});
      }catch(_){ }
      return res.json({ ok:true, type:'tv', tmdb_id: tv_id, title: d.name, year: realYear });
    }

    // Películas
    let tmdb_id = tmdbId;
    let realTitle = title;
    let realYear = year;

    if (!tmdb_id && title) {
      const m = await tmdbSearchMovie(title, year ? parseInt(year) : undefined);
      if (!m) return res.status(404).json({ error: 'No se encontró la película en TMDB' });
      tmdb_id = m.id;
      realTitle = m.title;
      realYear = m.release_date ? parseInt(m.release_date.slice(0, 4)) : year || null;
    }

    if (!tmdb_id) return res.status(400).json({ error: 'Falta tmdbId o title' });

    await new Promise((resolve, reject) => {
      const sql = 'INSERT OR REPLACE INTO movies (tmdb_id, title, year, link, genre_ids) VALUES (?, ?, ?, ?, ?)';
      db.run(sql, [ tmdb_id, realTitle || '', realYear || null, normalizeLink(link), null ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const d = await getTmdbMovieDetails(tmdb_id);
    try{
      const enc = encodeGenreIds(d?.genres || []);
      db.run('UPDATE movies SET genre_ids = ? WHERE tmdb_id = ?', [enc, tmdb_id], ()=>{});
    }catch(_){ }
    res.json({ ok: true, type:'movie', tmdb_id, title: d.title, year: realYear });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo añadir' });
  }
});


// POST /api/admin/bulkImport
app.post('/api/admin/bulkImport', adminGuard, async (req, res) => {
  try {
    const { text, type } = req.body;
    if (!text) return res.status(400).json({ error: 'Falta text' });

    const isTv = (type === 'tv');

    // TV bulk import format:
    // Titulo (año) | Payload
    if (isTv){
      const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const errors = [];
      const out = [];

      for (const line of lines){
        // Accept: Title (2008) | s1234
        const m = line.match(/^(.+?)\s*\((\d{4})\)\s*\|\s*(\S+)\s*$/);
        if (!m){
          errors.push({ line, error: 'Formato inválido. Usa: Titulo (año) | Payload' });
          continue;
        }
        const rawTitle = m[1].trim();
        const year = parseInt(m[2], 10);
        const payload = m[3].trim();

        try{
          const t = await tmdbSearchTv(rawTitle, year);
          if (!t){
            errors.push({ title: rawTitle, year, payload, error: 'No TMDB match' });
            continue;
          }

          const tv_id = t.id;
          const realName = t.name;
          const realYear = t.first_air_date ? parseInt(String(t.first_air_date).slice(0,4), 10) : year || null;
          const tg = buildTelegramForPayload(payload);
          const link = tg?.web || '';

          await new Promise((resolve, reject)=>{
            const sql = 'INSERT OR REPLACE INTO series (tmdb_id, name, first_air_year, link, payload, genre_ids) VALUES (?, ?, ?, ?, ?, ?)';
            db.run(sql, [ tv_id, realName || rawTitle, realYear, normalizeLink(link), payload, null ], (err)=> err?reject(err):resolve());
          });

          // genres best-effort
          try{
            const d = await getTmdbTvDetails(tv_id);
            const enc = encodeGenreIds(d?.genres || []);
            db.run('UPDATE series SET genre_ids = ? WHERE tmdb_id = ?', [enc, tv_id], ()=>{});
          }catch(_){ }

          out.push({ tmdb_id: tv_id, title: realName, year: realYear, payload });
        }catch(e){
          console.error('TV import error', line, e.message);
          errors.push({ title: rawTitle, year, payload, error: e.message });
        }
      }

      return res.json({ ok: true, imported: out.length, items: out, errors });
    }

    const re = /\[(.+?)\s*\((\d{4})\)\]\((https?:[^\)]+)\)/g;
    const out = [];
    const errors = [];
    let match;

    const tasks = [];
    while ((match = re.exec(text)) !== null) {
      const title = match[1].trim();
      const year = parseInt(match[2]);
      const link = match[3].trim();
      tasks.push({ title, year, link });
    }

    for (const t of tasks) {
      try {
        const m = await tmdbSearchMovie(t.title, t.year);
        if (!m) {
          errors.push({ ...t, error: 'No TMDB match' });
          continue;
        }
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT OR REPLACE INTO movies (tmdb_id, title, year, link, genre_ids) VALUES (?, ?, ?, ?, ?)',
            [m.id, m.title, t.year, t.link, null],
            function (err) {
              if (err) return reject(err);
              resolve();
            }
          );
        });

        // Store genres best-effort (so category filter works immediately)
        try{
          const meta = await getMovieMetaFast(m.id);
          const enc = encodeGenreIds(meta.genres);
          db.run('UPDATE movies SET genre_ids = ? WHERE tmdb_id = ?', [enc, m.id], ()=>{});
        }catch(_){ }
        out.push({ tmdb_id: m.id, title: m.title, year: t.year });
      } catch (e) {
        console.error('Import error', t, e.message);
        errors.push({ ...t, error: e.message });
      }
    }

    res.json({ ok: true, imported: out.length, items: out, errors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo importar' });
  }
});


// DELETE /api/admin/delete
app.post('/api/admin/delete', adminGuard, async (req, res) => {
  try {
    const { title, year, type } = req.body; const isTv = (type==='tv');
    if (!title) return res.status(400).json({ error: 'Falta título' });

    const t = String(title).trim().toLowerCase();
    const y = year ? parseInt(year) : null;

    // Buscar candidatos por título (case-insensitive) y opcionalmente por año
    const rows = await new Promise((resolve, reject) => {
      const sql = isTv ? (y
        ? 'SELECT tmdb_id, name as title, first_air_year as year FROM series WHERE LOWER(name) = ? AND first_air_year = ?'
        : 'SELECT tmdb_id, name as title, first_air_year as year FROM series WHERE LOWER(name) = ?')
        : (y
        ? 'SELECT tmdb_id, title, year FROM movies WHERE LOWER(title) = ? AND year = ?'
        : 'SELECT tmdb_id, title, year FROM movies WHERE LOWER(title) = ?');
      const params = y ? [t, y] : [t];
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    if (!rows.length) return res.json({ deleted: 0, matches: [] });

    // Eliminar todos los matches encontrados
    const ids = rows.map(r => r.tmdb_id);
    await new Promise((resolve, reject) => {
      const placeholders = ids.map(()=>'?').join(',');
      db.run(isTv ? `DELETE FROM series WHERE tmdb_id IN (${placeholders})` : `DELETE FROM movies WHERE tmdb_id IN (${placeholders})`, ids, function(err){
        if (err) return reject(err);
        resolve();
      });
    });

    res.json({ deleted: ids.length, matches: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar' });
  }
});



// POST /api/admin/deleteById
app.post('/api/admin/deleteById', adminGuard, async (req, res) => {
  try {
    const { tmdb_id, type } = req.body; const isTv = (type==='tv');
    const id = Number(tmdb_id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'tmdb_id inválido' });

    // Fetch movie info (optional, for UI feedback)
    const movie = await new Promise((resolve, reject) => {
      db.get(isTv ? 'SELECT tmdb_id, name as title, first_air_year as year FROM series WHERE tmdb_id = ?' : 'SELECT tmdb_id, title, year FROM movies WHERE tmdb_id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

    // Delete
    const deleted = await new Promise((resolve, reject) => {
      db.run(isTv ? 'DELETE FROM series WHERE tmdb_id = ?' : 'DELETE FROM movies WHERE tmdb_id = ?', [id], function(err){
        if (err) return reject(err);
        resolve(this.changes || 0);
      });
    });

    res.json({ deleted, match: movie });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar por ID' });
  }
});

// GET /api/admin/export
app.get('/api/admin/export', adminGuard, async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT tmdb_id, title, year, link, created_at FROM movies ORDER BY created_at DESC', (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    res.json({ count: rows.length, items: rows });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});


// === Watch page (no real URL exposed) ===
// (disabled) /watch page removed in favor of direct PixelDrain links



// --- Collections API ---
app.get('/api/collections', (req, res) => {
  db.all(
    `SELECT c.id, c.name, c.cover_image, c.created_at, u.username,
            (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) as items_count
     FROM collections c
     JOIN users u ON u.id = c.user_id
     ORDER BY datetime(c.created_at) DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB_ERROR' });
      res.json((rows || []).map(r => ({
        id: r.id,
        name: r.name,
        cover_image: r.cover_image || null,
        created_at: r.created_at,
        username: r.username,
        items_count: r.items_count
      })));
    }
  );
});

// GET /api/collections/mine  (private)
app.get('/api/collections/mine', requireAuth, (req, res) => {
  const u = getSessionUser(req);
  db.all(
    `SELECT c.id, c.name, c.cover_image, c.created_at, u.username,
            (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) as items_count
     FROM collections c
     JOIN users u ON u.id = c.user_id
     WHERE c.user_id = ?
     ORDER BY datetime(c.created_at) DESC`,
    [u.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB_ERROR' });
      res.json((rows || []).map(r => ({
        id: r.id,
        name: r.name,
        cover_image: r.cover_image || null,
        created_at: r.created_at,
        username: r.username,
        items_count: r.items_count
      })));
    }
  );
});

app.get('/api/collections/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID_INVALID' });

  db.get(
    `SELECT c.id, c.name, c.cover_image, c.created_at, u.username
     FROM collections c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    [id],
    (err, col) => {
      if (err) return res.status(500).json({ error: 'DB_ERROR' });
      if (!col) return res.status(404).json({ error: 'NOT_FOUND' });

      db.all(
        `SELECT ci.tmdb_id, m.title, m.year
         FROM collection_items ci
         LEFT JOIN movies m ON m.tmdb_id = ci.tmdb_id
         WHERE ci.collection_id = ?
         ORDER BY ci.position ASC, ci.id ASC`,
        [id],
        async (err2, rows) => {
          if (err2) return res.status(500).json({ error: 'DB_ERROR' });
          const base = rows || [];
          try{
            const enriched = await Promise.all(base.map(async (r) => {
              const key = 'tmdb:movie:' + r.tmdb_id;
              const cached = mcGet(key);
              if (cached) return { ...r, poster_path: cached.poster_path || null };
              const d = await tmdbGetMovieDetails(r.tmdb_id);
              mcSet(key, { poster_path: d?.poster_path || null });
              return { ...r, poster_path: d?.poster_path || null };
            }));
            res.json({
              id: col.id,
              name: col.name,
              cover_image: col.cover_image || null,
              created_at: col.created_at,
              username: col.username,
              items_count: enriched.length,
              items: enriched.map(x => ({ tmdb_id: x.tmdb_id, title: x.title, year: x.year, poster_path: x.poster_path }))
            });
          }catch(_){
            res.json({
              id: col.id,
              name: col.name,
              cover_image: col.cover_image || null,
              created_at: col.created_at,
              username: col.username,
              items_count: base.length,
              items: base.map(x => ({ tmdb_id: x.tmdb_id, title: x.title, year: x.year, poster_path: null }))
            });
          }
        }
      );
    }
  );
});

app.post('/api/collections', requireAuth, (req, res) => {
  const u = getSessionUser(req);
  const name = String(req.body?.name || '').trim();
  const cover = req.body?.cover_image || null;
  const items = Array.isArray(req.body?.items) ? req.body.items.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];

  if (!name || name.length < 2 || name.length > 60) return res.status(400).json({ error: 'NAME_INVALID' });
  if (!items.length) return res.status(400).json({ error: 'ITEMS_INVALID' });

  if (cover){
    const s = String(cover);
    if (!/^data:image\/(webp|png|jpeg);base64,/i.test(s)) return res.status(400).json({ error: 'IMAGE_INVALID' });
    const b64 = s.split(',')[1] || '';
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes > 45000) return res.status(400).json({ error: 'IMAGE_TOO_LARGE' });
  }

  db.run(
    `INSERT INTO collections (user_id, name, cover_image) VALUES (?, ?, ?)`,
    [u.id, name, cover || null],
    function(err){
      if (err) return res.status(500).json({ error: 'DB_ERROR' });
      const colId = this.lastID;

      const stmt = db.prepare(`INSERT OR IGNORE INTO collection_items (collection_id, tmdb_id, position) VALUES (?, ?, ?)`);
      items.forEach((tmdbId, idx) => stmt.run([colId, tmdbId, idx]));
      stmt.finalize(() => res.json({ ok: true, id: colId }));
    }
  );
});

// PUT /api/collections/:id  (update collection: name, cover, items)
app.put('/api/collections/:id', requireAuth, (req, res) => {
  const u = getSessionUser(req);
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID_INVALID' });

  const name = String(req.body?.name || '').trim();
  const cover = req.body?.cover_image || null;
  const items = Array.isArray(req.body?.items) ? req.body.items.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];

  if (!name || name.length < 2 || name.length > 60) return res.status(400).json({ error: 'NAME_INVALID' });
  if (!items.length) return res.status(400).json({ error: 'ITEMS_INVALID' });

  if (cover){
    const s = String(cover);
    if (!/^data:image\/(webp|png|jpeg);base64,/i.test(s)) return res.status(400).json({ error: 'IMAGE_INVALID' });
    const b64 = s.split(',')[1] || '';
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes > 45000) return res.status(400).json({ error: 'IMAGE_TOO_LARGE' });
  }

  db.get(
    `SELECT id FROM collections WHERE id = ? AND user_id = ?`,
    [id, u.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'DB_ERROR' });
      if (!row) return res.status(403).json({ error: 'FORBIDDEN' });

      db.run(
        `UPDATE collections SET name = ?, cover_image = ? WHERE id = ? AND user_id = ?`,
        [name, cover || null, id, u.id],
        (err2) => {
          if (err2) return res.status(500).json({ error: 'DB_ERROR' });

          // Replace items (simple & safe)
          db.serialize(() => {
            db.run(`DELETE FROM collection_items WHERE collection_id = ?`, [id], (err3) => {
              if (err3) return res.status(500).json({ error: 'DB_ERROR' });
              const stmt = db.prepare(`INSERT OR IGNORE INTO collection_items (collection_id, tmdb_id, position) VALUES (?, ?, ?)`);
              items.forEach((tmdbId, idx) => stmt.run([id, tmdbId, idx]));
              stmt.finalize(() => res.json({ ok: true }));
            });
          });
        }
      );
    }
  );
});

// DELETE /api/collections/:id
app.delete('/api/collections/:id', requireAuth, (req, res) => {
  const u = getSessionUser(req);
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID_INVALID' });
  db.run(
    `DELETE FROM collections WHERE id = ? AND user_id = ?`,
    [id, u.id],
    function(err){
      if (err) return res.status(500).json({ error: 'DB_ERROR' });
      if (this.changes === 0) return res.status(403).json({ error: 'FORBIDDEN' });
      res.json({ ok: true });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Cine Castellano HD listo en http://localhost:${PORT}`);
  // Best-effort background task to populate genre_ids so category filtering works reliably.
  // It runs once on start and keeps the server responsive.
  backfillGenreIdsInBackground().catch(()=>{});
});