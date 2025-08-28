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

// Serve the catalog page (index.html or catalog_updated.html) when the user visits the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'catalog_updated.html'));
});

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

async function tmdbGetGenres() {
  const url = `https://api.themoviedb.org/3/genre/movie/list`;
  const { data } = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
  return data.genres || [];
}

app.get('/api/genres', async (req, res) => {
  try {
    const genres = await tmdbGetGenres();
    res.json(genres);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron obtener los géneros' });
  }
});

app.get('/api/movies', async (req, res) => {
  try {
    const { genre, page = 1, pageSize = 24, orderBy = 'title', orderDirection = 'ASC' } = req.query;

    const where = [];
    const params = [];
    if (genre) { where.push('year = ?'); params.push(genre); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const validOrderDirection = ['ASC', 'DESC'].includes(orderDirection.toUpperCase()) ? orderDirection : 'ASC'; // Ensure valid direction

    const count = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as c FROM movies ${whereSql}`, params, (err, row) => err ? reject(err) : resolve(row.c));
    });

    const limit = Math.min(parseInt(pageSize), 60) || 24;
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, title, year, link FROM movies ${whereSql} ORDER BY ${orderBy} ${validOrderDirection} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    const details = await Promise.all(rows.map(r => tmdbGetMovieDetails(r.tmdb_id)));
    let items = rows.map((r, i) => ({ ...r, poster_path: details[i]?.poster_path || null, _details: details[i] || null }));

    items = items.map(({ _details, ...rest }) => rest);

    res.json({ total: count, page: Number(page), pageSize: limit, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo obtener el listado' });
  }
});

app.listen(PORT, () => console.log(`Cine Castellano HD listo en http://localhost:${PORT}`));
