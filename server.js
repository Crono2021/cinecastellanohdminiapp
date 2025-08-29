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

app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to handle bulk movie import
app.post('/api/admin/bulkImport', adminGuard, async (req, res) => {
  const text = req.body.text;
  if (!text) return res.status(400).json({ error: 'No se proporcionó texto' });

  const lines = text.split('
').map(line => line.trim()).filter(line => line.length > 0);
  const errors = [];
  const imported = [];

  for (const line of lines) {
    // Regex to extract title, year, and link
    const regex = /\[(.*?)\]\((https:\/\/pixeldrain\.net\/[^\)]+)\)/;
    const match = line.match(regex);

    if (!match) {
      errors.push(`Error con la línea: ${line}`);
      continue;
    }

    const title = match[1];
    const link = match[2];
    const year = title.match(/\((\d{4})\)/);
    const parsedYear = year ? year[1] : null;

    try {
      const movie = await tmdbSearchMovie(title, parsedYear);
      if (movie) {
        const tmdbId = movie.id;
        await new Promise((resolve, reject) => {
          db.run('INSERT OR REPLACE INTO movies (tmdb_id, title, year, link) VALUES (?, ?, ?, ?)', [tmdbId, title, parsedYear, link], function(err) {
            if (err) return reject(err);
            resolve();
          });
        });
        imported.push({ title, year: parsedYear, link });
      } else {
        errors.push(`Película no encontrada: ${title}`);
      }
    } catch (err) {
      errors.push(`Error al procesar la línea: ${line}`);
    }
  }

  res.json({ imported: imported.length, errors });
});

app.listen(PORT, () => console.log(`Cine Castellano HD listo en http://localhost:${PORT}`));
