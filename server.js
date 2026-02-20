/* eslint-disable */
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const app = express();

// In-memory micro cache
const microCache = new Map();
const MC_TTL_MS = 60 * 1000; // 60s
function mcGet(key){ const v = microCache.get(key); if(!v) return null; if(Date.now()-v.t>MC_TTL_MS){ microCache.delete(key); return null;} return v.d; }
function mcSet(key, data){ microCache.set(key, {t:Date.now(), d:data}); }
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Config ---
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cchd-admin-token-cambialo';
const PORT = process.env.PORT || 3000;

if (!TMDB_API_KEY) {
  console.warn('[AVISO] TMDB_API_KEY no está definido. Ponlo en .env');
}

// --- DB (persistencia opcional vía DB_PATH) ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(DB_PATH);



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
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS series (
    tmdb_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    first_air_year INTEGER,
    link TEXT NOT NULL,
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
});

function ymdLocal(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
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
    const { q, genre, page = 1, pageSize = 24 } = req.query;
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

    const total = Number(totalMovies) + Number(totalSeries);

    // Fetch a generous window from both, order by rowid desc to approximate recency
    const movies = await new Promise((resolve, reject) => {
      const where = qLike ? "WHERE LOWER(title) LIKE ?" : "";
      const params = qLike ? [qLike] : [];
      db.all(`SELECT tmdb_id, title, year, link, created_at FROM movies ${where} ORDER BY rowid DESC`, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    const series = await new Promise((resolve, reject) => {
      const where = qLike ? "WHERE LOWER(name) LIKE ?" : "";
      const params = qLike ? [qLike] : [];
      db.all(`SELECT tmdb_id, name AS title, first_air_year AS year, link, created_at FROM series ${where} ORDER BY rowid DESC`, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    let items = [
      ...movies.map(m => ({ type:'movie', ...m })),
      ...series.map(s => ({ type:'tv', ...s })),
    ];

    // Sort by created_at desc (fallback to tmdb_id desc)
    items.sort((a,b)=>{
      const da = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dbb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (dbb !== da) return dbb - da;
      return (b.tmdb_id||0) - (a.tmdb_id||0);
    });

    // Enrich only the current page to keep it fast
    const startIdx = (pageNum - 1) * limit;
    const pageItems = items.slice(startIdx, startIdx + limit);

    const enriched = await Promise.all(pageItems.map(async (it) => {
      try{
        if (it.type === 'tv'){
          const d = await getTmdbTvDetails(it.tmdb_id);
          return { ...it, poster_path: d?.poster_path || null };
        }else{
          const d = await getTmdbMovieDetails(it.tmdb_id);
          return { ...it, poster_path: d?.poster_path || null };
        }
      }catch(_){
        return { ...it, poster_path: null };
      }
    }));

    // Optional: genre filtering (applies to current page only to keep performance)
    let finalItems = enriched;
    if (genre) {
      const filtered = [];
      for (const it of enriched){
        try{
          const d = it.type === 'tv' ? await getTmdbTvDetails(it.tmdb_id) : await getTmdbMovieDetails(it.tmdb_id);
          if (d?.genres?.some(g => String(g.id) == String(genre))) filtered.push(it);
        }catch(_){}
      }
      finalItems = filtered;
    }

    res.json({ total, page: pageNum, pageSize: limit, items: finalItems });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el catálogo' });
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
      db.all(`SELECT tmdb_id, name as title, first_air_year as year, link FROM series ${whereSql} LIMIT ? OFFSET ?`, [...params, limit, offset], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });

    const details = await Promise.all(rows.map(r => getTmdbTvDetails(r.tmdb_id)));

    let items = rows.map((r, i) => ({
      ...r,
      type: 'tv',
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


app.get('/api/movies', async (req, res) => {
  try {
    const { q, genre, actor, page = 1, pageSize = 24 } = req.query;

    let where = [];
    let params = [];

    if (q) {
      where.push('LOWER(title) LIKE ?');
      params.push('%' + String(q).toLowerCase() + '%');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as c FROM movies ${whereSql}`, params, (err, row) => {
        if (err) return reject(err);
        resolve(row.c);
      });
    });

    const limit = Math.min(parseInt(pageSize), 60) || 24;
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    const rows = await new Promise((resolve, reject) => {
      db.all(`SELECT tmdb_id, title, year, link FROM movies ${whereSql} LIMIT ? OFFSET ?`, [...params, limit, offset], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });

    const details = await Promise.all(rows.map(r => getTmdbMovieDetails(r.tmdb_id)));

    let items = rows.map((r, i) => ({
      ...r,
      type: 'movie',
      poster_path: details[i]?.poster_path || null,
      backdrop_path: details[i]?.backdrop_path || null,
      _details: details[i] || null
    }));

    if (actor) {
      const person = await tmdbSearchPersonByName(actor);
      if (person) {
        const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/movie_credits`;
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
      db.get('SELECT tmdb_id, name, first_air_year, link FROM series WHERE tmdb_id = ?', [tmdbId], (err, row) => {
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
      link: seriesRow ? normalizeLink(seriesRow.link) : null
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
      db.get('SELECT tmdb_id, name as title, first_air_year as year, link FROM series WHERE tmdb_id = ?', [tmdbId], (err, row) => {
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
        link: normalizeLink(seriesRow.link)
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
        const sql = 'INSERT OR REPLACE INTO series (tmdb_id, name, first_air_year, link) VALUES (?, ?, ?, ?)';
        db.run(sql, [ tv_id, realName || '', realYear || null, normalizeLink(link) ], (err)=> err?reject(err):resolve());
      });

      const d = await getTmdbTvDetails(tv_id);
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
      const sql = 'INSERT OR REPLACE INTO movies (tmdb_id, title, year, link) VALUES (?, ?, ?, ?)';
      db.run(sql, [ tmdb_id, realTitle || '', realYear || null, normalizeLink(link) ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const d = await getTmdbMovieDetails(tmdb_id);
    res.json({ ok: true, type:'movie', tmdb_id, title: d.title, year: realYear });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo añadir' });
  }
});


// POST /api/admin/bulkImport
app.post('/api/admin/bulkImport', adminGuard, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Falta text' });

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
          db.run('INSERT OR REPLACE INTO movies (tmdb_id, title, year, link) VALUES (?, ?, ?, ?)', [m.id, m.title, t.year, t.link], function (err) {
            if (err) return reject(err);
            resolve();
          });
        });
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

app.listen(PORT, () => {
  console.log(`Cine Castellano HD listo en http://localhost:${PORT}`);
});