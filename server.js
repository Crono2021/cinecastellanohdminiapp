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

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cchd-admin-token-cambialo';
const PORT = process.env.PORT || 3000;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(DB_PATH);

// Create indices for faster searches on 'title' and 'year'
db.serialize(() => {
  db.run(`CREATE INDEX IF NOT EXISTS idx_movies_title ON movies (title)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_movies_year ON movies (year)`);
});

function adminGuard(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado' });
  next();
}

async function tmdbSearchMovie(title, year) {
  const url = 'https://api.themoviedb.org/3/search/movie';
  const { data } = await axios.get(url, {
    params: { api_key: TMDB_API_KEY, query: title, include_adult: true, year: year || undefined, language: 'es-ES' }
  });
  if (!data.results || data.results.length === 0) return null;
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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/genres', async (req, res) => {
  try { res.json(await tmdbGetGenres()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron obtener los géneros' }); }
});

app.get('/api/movies', async (req, res) => {
  try {
    const { q, genre, actor, page = 1, pageSize = 24, orderBy = 'title', orderDirection = 'ASC' } = req.query;

    const where = [];
    const params = [];
    if (q) { where.push('LOWER(title) LIKE ?'); params.push(`%${String(q).toLowerCase()}%`); }
    if (genre) { where.push('year = ?'); params.push(genre); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderByColumn = orderBy; // Use orderBy parameter from query
    const orderDirection = ['ASC', 'DESC'].includes(orderDirection.toUpperCase()) ? orderDirection : 'ASC'; // Default to ASC

    const count = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as c FROM movies ${whereSql}`, params, (err, row) => err ? reject(err) : resolve(row.c));
    });

    const limit = Math.min(parseInt(pageSize), 60) || 24;
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, title, year, link FROM movies ${whereSql} ORDER BY ${orderByColumn} ${orderDirection} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    const details = await Promise.all(rows.map(r => tmdbGetMovieDetails(r.tmdb_id)));
    let items = rows.map((r, i) => ({ ...r, poster_path: details[i]?.poster_path || null, _details: details[i] || null }));

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

    items = items.map(({ _details, ...rest }) => rest);

    res.json({ total: count, page: Number(page), pageSize: limit, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el listado' });
  }
});

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

app.post('/api/admin/add', adminGuard, async (req, res) => {
  try {
    const { title, year, link, tmdbId } = req.body;
    if (!link) return res.status(400).json({ error: 'Falta link' });
    let tmdb_id = tmdbId, realTitle = title, realYear = year;
    if (!tmdb_id && title) {
      const m = await tmdbSearchMovie(title, year ? parseInt(year) : undefined);
      if (!m) return res.status(404).json({ error: 'No se encontró la película en TMDB' });
      tmdb_id = m.id; realTitle = m.title; realYear = m.release_date ? parseInt(m.release_date.slice(0,4)) : year || null;
    }
    if (tmdb_id && (!realTitle || !realYear)) {
      const d = await tmdbGetMovieDetails(tmdb_id);
      realTitle = realTitle || d?.title;
      realYear = realYear || (d?.release_date ? parseInt(d.release_date.slice(0,4)) : null);
    }
    if (!tmdb_id) return res.status(400).json({ error: 'Falta tmdbId o title' });
    await new Promise((resolve, reject) => {
      db.run('INSERT OR REPLACE INTO movies (tmdb_id, title, year, link) VALUES (?, ?, ?, ?)', [tmdb_id, realTitle || '', realYear || null, link], function(err){ return err ? reject(err) : resolve(); });
    });
    res.json({ ok: true, tmdb_id, title: realTitle, year: realYear });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo añadir' });
  }
});

app.listen(PORT, () => console.log(`Cine Castellano HD listo en http://localhost:${PORT}`));
