/* server.js — listo para Supabase (Postgres) o SQLite local
 * Requisitos env:
 *  - PORT (opcional)
 *  - DATABASE_URL (Postgres Supabase; pooler:6543; sslmode=require)
 *  - TMDB_API_KEY (para enriquecer catálogo; opcional)
 *  - ADMIN_TOKEN (para /api/admin/*)
 *  - NO_TMDB=1 (opcional, desactiva llamadas a TMDB)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* =========================
   Base de datos
   ========================= */
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db.sqlite');
const DATABASE_URL = process.env.DATABASE_URL;
const usePg = !!DATABASE_URL;

let db;
let pool = null;

if (usePg) {
  pool = new Pool({
    connectionString: DATABASE_URL, // ej: postgresql://USER:PASSWORD@...pooler.supabase.com:6543/postgres?sslmode=require
    ssl: { rejectUnauthorized: false }
  });

  function toPg(sql) {
    let i = 0;
    let out = sql.replace(/\binsert\s+or\s+replace\b/ig, 'INSERT');
    out = out.replace(/\?/g, () => '$' + (++i));
    out = out.replace(/datetime\('now'\)/ig, 'CURRENT_TIMESTAMP');
    if (/INSERT\s+INTO\s+movies/i.test(out) && !/ON\s+CONFLICT/i.test(out)) {
      out = out.replace(/;?$/, ' ON CONFLICT (tmdb_id) DO UPDATE SET title = EXCLUDED.title, year = EXCLUDED.year, link = EXCLUDED.link;');
    }
    return out;
  }

  db = {
    get(sql, params = [], cb) {
      const q = toPg(sql);
      pool.query(q, params).then(r => cb && cb(null, (r.rows && r.rows[0]) || null)).catch(err => cb && cb(err));
    },
    all(sql, params = [], cb) {
      const q = toPg(sql);
      pool.query(q, params).then(r => cb && cb(null, r.rows)).catch(err => cb && cb(err));
    },
    run(sql, params = [], cb) {
      const q = toPg(sql);
      pool.query(q, params).then(() => cb && cb(null)).catch(err => cb && cb(err));
    },
    query(text, params = []) { // nativo PG
      return pool.query(text, params);
    },
    serialize(fn) { if (typeof fn === 'function') fn(); } // no-op
  };
  console.log('[DB] Mode: pg');
} else {
  const sqlite3 = require('sqlite3').verbose();
  const dbSqlite = new sqlite3.Database(DB_PATH);
  db = dbSqlite;
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS movies (
      tmdb_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      year INTEGER,
      link TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  });
  console.log('[DB] Mode: sqlite ->', DB_PATH);
}

/* =========================
   Helpers y middlewares
   ========================= */
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const NO_TMDB = process.env.NO_TMDB === '1';

async function tmdbGetMovieDetails(id) {
  if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY missing');
  const url = `https://api.themoviedb.org/3/movie/${id}`;
  const { data } = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
  return data;
}

async function tmdbSearchPersonByName(name) {
  if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY missing');
  const url = `https://api.themoviedb.org/3/search/person`;
  const { data } = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES', query: name } });
  return (data.results && data.results[0]) || null;
}

async function safeTmdbGetMovieDetails(tmdbId) {
  if (NO_TMDB || !TMDB_API_KEY) return null;
  try { return await tmdbGetMovieDetails(tmdbId); }
  catch { return null; }
}

function adminGuard(req, res, next) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/* =========================
   Rutas
   ========================= */

// Salud BD
app.get('/health/db', async (req, res) => {
  try {
    if (usePg) {
      const r = await (new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } }))
        .query('select now() as now, current_user as user, current_database() as db');
      return res.json({ mode: 'pg', now: r.rows[0].now, user: r.rows[0].user, db: r.rows[0].db });
    } else {
      return res.json({ mode: 'sqlite', path: DB_PATH });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export admin (listar últimas N)
app.get('/api/admin/export', async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT tmdb_id, title, year, link FROM movies ORDER BY tmdb_id DESC LIMIT ? OFFSET ?', [500, 0], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    res.json({ count: rows.length, items: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

// Añadir/actualizar película (admin)
app.post('/api/admin/add', adminGuard, async (req, res) => {
  try {
    let { tmdbId, title, year, link } = req.body;
    if (!link) return res.status(400).json({ error: 'link requerido' });

    let tmdb_id = tmdbId ? parseInt(tmdbId, 10) : null;
    let realTitle = title || '';
    let realYear = year ? parseInt(year, 10) : null;

    // Si no hay tmdbId pero hay título, intenta buscar en TMDB
    if (!tmdb_id && realTitle && TMDB_API_KEY && !NO_TMDB) {
      // (opcionalmente podrías buscar la peli por título)
      // aquí omitido por simplicidad
    }

    // UPSERT robusto
    if (db.query) {
      await db.query(
        `INSERT INTO public.movies (tmdb_id, title, year, link)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tmdb_id) DO UPDATE
           SET title = EXCLUDED.title,
               year  = EXCLUDED.year,
               link  = EXCLUDED.link
         RETURNING tmdb_id`,
        [tmdb_id, realTitle ?? '', realYear ?? null, link]
      );
    } else {
      await new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO movies (tmdb_id, title, year, link) VALUES (?, ?, ?, ?)', [tmdb_id, realTitle || '', realYear || null, link], function (err) {
          if (err) return reject(err);
          resolve();
        });
      });
    }

    res.json({ ok: true, tmdb_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo añadir' });
  }
});

// Catálogo (lista con enriquecimiento opcional TMDB)
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

    // total
    const totalRow = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as c FROM movies ${whereSql}`, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    const total = totalRow?.c || 0;

    const limit = Math.max(parseInt(pageSize), 1);
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    // filas
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT tmdb_id, title, year, link FROM movies ${whereSql} ORDER BY tmdb_id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });

    // enriquecer sin romper si TMDB falla
    let details = await Promise.allSettled(rows.map(r => safeTmdbGetMovieDetails(r.tmdb_id)));
    details = details.map(d => (d.status === 'fulfilled' ? d.value : null));

    let items = rows.map((r, i) => ({
      ...r,
      poster_path: details[i]?.poster_path || null,
      _details: details[i] || null
    }));

    // filtros por actor/genre si hay TMDB
    if (!NO_TMDB && TMDB_API_KEY) {
      if (actor) {
        const person = await tmdbSearchPersonByName(actor).catch(() => null);
        if (person) {
          const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/movie_credits`;
          try {
            const { data } = await axios.get(creditsUrl, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
            const ids = new Set((data.cast || []).concat(data.crew || []).map(m => m.id));
            items = items.filter(it => ids.has(it.tmdb_id));
          } catch (_) { /* ignora error TMDB */ }
        }
      }
      if (genre) {
        items = items.filter(it => it._details?.genres?.some(g => String(g.id) === String(genre)));
      }
    }

    items = items.map(({ _details, ...rest }) => rest);
    res.json({ total, page: Number(page), pageSize: limit, items });
  } catch (e) {
    console.error(e);
    // fallback: al menos devolver algo desde BD
    try {
      const rows = await new Promise((resolve, reject) => {
        db.all(`SELECT tmdb_id, title, year, link FROM movies ORDER BY tmdb_id DESC LIMIT 24 OFFSET 0`, [], (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        });
      });
      return res.json({ total: rows.length, page: 1, pageSize: rows.length, items: rows });
    } catch (e2) {
      return res.status(500).json({ error: 'No se pudo listar' });
    }
  }
});

// Detalle simple (opcional)
app.get('/api/movie/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT tmdb_id, title, year, link FROM movies WHERE tmdb_id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo obtener' });
  }
});

// Arranque
app.listen(PORT, () => {
  console.log(`Servidor en http://0.0.0.0:${PORT}`);
});
