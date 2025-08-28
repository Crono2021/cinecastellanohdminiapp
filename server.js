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
  console.warn('[AVISO] TMDB_API_KEY no está definido. Ponlo en Variables de entorno.');
}

// --- DB (persistencia opcional via DB_PATH) ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS movies (
    tmdb_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    year INTEGER,
    link TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    release_date TEXT
  )`);
  // Si la tabla existía sin release_date, intentamos añadirla
  db.run(`ALTER TABLE movies ADD COLUMN release_date TEXT`, (err) => {
    if (err && !String(err).includes('duplicate column')) {
      console.warn('ALTER TABLE release_date error:', err.message);
    }
  });
});

// --- Helpers ---
function adminGuard(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado' });
  next();
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

// --- Static ---
app.use(express.static(path.join(__dirname, 'public')));

// --- API ---

// GET /api/genres
app.get('/api/genres', async (req, res) => {
  try { res.json(await tmdbGetGenres()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron obtener los géneros' }); }
});

// GET /api/movies – filtros: q (título), actor, genre (id TMDB), year (yyyy). Orden: fecha de estreno desc.
app.get('/api/movies', async (req, res) => {
  try {
    const { q, genre, actor, year, page = 1, pageSize = 24 } = req.query;

    const where = [];
    const params = [];

    if (q) { where.push('LOWER(title) LIKE ?'); params.push(`%${String(q).toLowerCase()}%`); }
    if (year && /^\d{4}$/.test(String(year))) { where.push('year = ?'); params.push(parseInt(year)); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const count = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as c FROM movies ${whereSql}`, params, (err, row) => err ? reject(err) : resolve(row.c));
    });

    const limit = Math.min(parseInt(pageSize), 60) || 24;
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, title, year, link, release_date
         FROM movies ${whereSql}
         ORDER BY COALESCE(release_date, printf('%04d-01-01',year), created_at) DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });

    // Enriquecer con detalles (para póster y filtros por género/actor)
    const details = await Promise.all(rows.map(r => tmdbGetMovieDetails(r.tmdb_id)));
    let items = rows.map((r, i) => ({
      ...r,
      poster_path: details[i]?.poster_path || null,
      _details: details[i] || null
    }));

    // Filtro por actor (si aplica)
    if (actor) {
      const person = await tmdbSearchPersonByName(actor);
      if (person) {
        const { data } = await axios.get(`https://api.themoviedb.org/3/person/${person.id}/movie_credits`, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
        const ids = new Set((data.cast || []).concat(data.crew || []).map(m => m.id));
        items = items.filter(it => ids.has(it.tmdb_id));
      } else {
        items = [];
      }
    }

    // Filtro por género (si aplica)
    if (genre) {
      items = items.filter(it => it._details?.genres?.some(g => String(g.id) === String(genre)));
    }

    // Limpiar _details del payload
    items = items.map(({ _details, ...rest }) => rest);

    res.json({ total: count, page: Number(page), pageSize: limit, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el listado' });
  }
});

// GET /api/movie/:id – detalle + link
app.get('/api/movie/:id', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.id);
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT tmdb_id, title, year, link FROM movies WHERE tmdb_id = ?', [tmdbId], (err, row) => err ? reject(err) : resolve(row));
    });
    const d = await tmdbGetMovieDetails(tmdbId);
    res.json({ ...d, link: row ? row.link : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron obtener los detalles' });
  }
});

// POST /api/admin/add – alta 1 a 1 (por título/año o por tmdbId)
app.post('/api/admin/add', adminGuard, async (req, res) => {
  try {
    const { title, year, link, tmdbId } = req.body;
    if (!link) return res.status(400).json({ error: 'Falta link' });

    let tmdb_id = tmdbId, realTitle = title, realYear = year, realRelease = null;

    if (tmdb_id && (!realTitle || !realYear)) {
      const d = await tmdbGetMovieDetails(tmdb_id);
      realTitle = realTitle || d.title;
      realYear = realYear || (d.release_date ? parseInt(d.release_date.slice(0, 4)) : null);
      realRelease = d.release_date || null;
    } else if (!tmdb_id && title) {
      const m = await tmdbSearchMovie(title, year ? parseInt(year) : undefined);
      if (!m) return res.status(404).json({ error: 'No se encontró la película en TMDB' });
      tmdb_id = m.id;
      realTitle = m.title;
      realYear = m.release_date ? parseInt(m.release_date.slice(0, 4)) : year || null;
      realRelease = m.release_date || null;
    }

    if (!tmdb_id) return res.status(400).json({ error: 'Falta tmdbId o title' });

    await new Promise((resolve, reject) => {
      db.run(
        'INSERT OR REPLACE INTO movies (tmdb_id, title, year, link, release_date) VALUES (?, ?, ?, ?, ?)',
        [tmdb_id, realTitle || '', realYear || null, link, realRelease || null],
        function (err) { return err ? reject(err) : resolve(); }
      );
    });

    res.json({ ok: true, tmdb_id, title: realTitle, year: realYear });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo añadir' });
  }
});

// POST /api/admin/bulkImport – importar por TXT
app.post('/api/admin/bulkImport', adminGuard, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Falta text' });

    const re = /\[(.+?)\s*\((\d{4})\)\]\((https?:[^\)]+)\)/g;
    const out = [], errors = [];
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
        if (!m) { errors.push({ ...t, error: 'No TMDB match' }); continue; }
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT OR REPLACE INTO movies (tmdb_id, title, year, link, release_date) VALUES (?, ?, ?, ?, ?)',
            [m.id, m.title, t.year, t.link, m.release_date || null],
            function (err) { return err ? reject(err) : resolve(); }
          );
        });
        out.push({ tmdb_id: m.id, title: m.title, year: t.year });
      } catch (e) {
        errors.push({ ...t, error: e.message });
      }
    }

    res.json({ ok: true, imported: out.length, items: out, errors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo importar' });
  }
});

// GET /api/admin/export – exportar catálogo (ordenado por estreno desc)
app.get('/api/admin/export', adminGuard, async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, title, year, link, created_at, release_date
         FROM movies
         ORDER BY COALESCE(release_date, printf('%04d-01-01',year), created_at) DESC`,
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });
    res.json({ count: rows.length, items: rows });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

// --- Backfill de release_date en arranque (hasta 50 filas) ---
(async function backfillReleaseDates(){
  try{
    const need = await new Promise((resolve,reject)=>{
      db.all('SELECT tmdb_id FROM movies WHERE release_date IS NULL OR release_date = "" LIMIT 50', (err, rows)=>{
        if(err) return reject(err);
        resolve(rows||[]);
      });
    });
    for(const r of need){
      try{
        const d = await tmdbGetMovieDetails(r.tmdb_id);
        if (d && d.release_date){
          await new Promise((res,rej)=>{
            db.run('UPDATE movies SET release_date=? WHERE tmdb_id=?', [d.release_date, r.tmdb_id], (e)=> e?rej(e):res());
          });
        }
      }catch(_){ /* ignore */ }
    }
    if (need.length) console.log('Backfill release_date completado para', need.length, 'películas');
  }catch(e){
    console.warn('Backfill release_date error:', e.message);
  }
})();

app.listen(PORT, () => {
  console.log(`Cine Castellano HD listo en http://localhost:${PORT}`);
});
