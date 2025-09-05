/* eslint-disable */
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const app = express();
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
});


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

async function tmdbGetGenres() {
  const url = `https://api.themoviedb.org/3/genre/movie/list`;
  const { data } = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
  return data.genres || [];
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

// GET /api/movies – q, genre, actor, page, pageSize (enriquecido con poster_path)

// GET /api/catalog -- unified movies + series
app.get('/api/catalog', async (req, res) => {
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
      const params = qLike ? [qLike, 1000] : [1000];
      db.all(`SELECT tmdb_id, title, year, link, created_at FROM movies ${where} ORDER BY rowid DESC LIMIT ?`, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    const series = await new Promise((resolve, reject) => {
      const where = qLike ? "WHERE LOWER(name) LIKE ?" : "";
      const params = qLike ? [qLike, 1000] : [1000];
      db.all(`SELECT tmdb_id, name AS title, first_air_year AS year, link, created_at FROM series ${where} ORDER BY rowid DESC LIMIT ?`, params, (err, rows) => {
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
      db.all(`SELECT tmdb_id, title, year, link FROM movies ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });

    const details = await Promise.all(rows.map(r => tmdbGetMovieDetails(r.tmdb_id)));

    let items = rows.map((r, i) => ({
      ...r,
      poster_path: details[i]?.poster_path || null,
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

app.post('/api/admin/add', adminGuard, async (req, res) => {
  try {
    const { title, year, link, tmdbId, type } = req.body;
    if (!link) return res.status(400).json({ error: 'Falta link' });
    const isTv = (type === 'tv');

    if (isTv){
      let tv_id = tmdbId;
      let realName = title;
      let realYear = year;

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