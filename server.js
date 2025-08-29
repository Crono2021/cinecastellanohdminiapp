
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const app = express();  // Initialize Express app
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

// Admin token check middleware
function adminGuard(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// Bulk import route for adding movies
app.post('/admin/bulk-import', adminGuard, (req, res) => {
  const { movies } = req.body;
  if (!Array.isArray(movies)) return res.status(400).send('Formato incorrecto');

  const stmt = db.prepare('INSERT INTO movies (title, year, link) VALUES (?, ?, ?)');
  db.serialize(() => {
    for (const movie of movies) {
      stmt.run(movie.title, movie.year, movie.link);
    }
  });
  stmt.finalize();
  res.send(`Importadas ${movies.length} películas`);
});

// Start the server
app.listen(PORT, () => console.log(`Cine Castellano HD listo en http://localhost:${PORT}`));
