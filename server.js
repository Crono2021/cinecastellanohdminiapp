/* server.js — Supabase Postgres only (sin SQLite), robusto y simple
 * ENV en Render:
 *  - PORT (opcional)
 *  - DATABASE_URL  (pooler:6543; contraseña codificada; puede ir sin sslmode)
 *  - ADMIN_TOKEN   (para /api/admin/*)
 *  - TMDB_API_KEY  (opcional: enriquecer catálogo y buscar tmdbId)
 *  - NO_TMDB=1     (opcional: desactivar llamadas a TMDB)
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

// Pool Postgres (acepta el cert de Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const db = { query: (text, params=[]) => pool.query(text, params) };

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const NO_TMDB = process.env.NO_TMDB === '1';

function adminGuard(req, res, next) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ===== Setup mínimo en la BD: índice único y secuencia de IDs manuales =====
let setupDone = false;
async function ensureDbSetup() {
  if (setupDone) return;
  try {
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS movies_tmdb_id_key ON public.movies (tmdb_id);`);
  } catch (e) {
    // Si ya existe una PK/unique diferente no pasa nada
  }
  try {
    await db.query(`CREATE SEQUENCE IF NOT EXISTS manual_tmdb_id_seq INCREMENT -1 START -1 MINVALUE -9223372036854775808;`);
  } catch (e) {}
  setupDone = true;
}

// ===== Helpers TMDB (seguros) =====
async function tmdbGetMovieDetails(id) {
  if (!TMDB_API_KEY || NO_TMDB) return null;
  const url = `https://api.themoviedb.org/3/movie/${id}`;
  const { data } = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'es-ES' } });
  return data;
}
async function tmdbSearchMovieByTitleYear(title, year) {
  if (!TMDB_API_KEY || NO_TMDB) return null;
  const url = `https://api.themoviedb.org/3/search/movie`;
  const params = { api_key: TMDB_API_KEY, language: 'es-ES', query: title };
  if (year) params.primary_release_year = year;
  const { data } = await axios.get(url, { params });
  return (data.results && data.results[0]) || null;
}
async function safeDetails(id) {
  try { return await tmdbGetMovieDetails(id); } catch { return null; }
}
async function getManualId() {
  try {
    const r = await db.query(`SELECT nextval('manual_tmdb_id_seq') AS id`);
    return r.rows[0].id; // negativo
  } catch {
    // secuencia inexistente (raro), vuelve a crear
    await ensureDbSetup();
    const r2 = await db.query(`SELECT nextval('manual_tmdb_id_seq') AS id`);
    return r2.rows[0].id;
  }
}

// ===== Health =====
app.get('/health/db', async (req, res) => {
  try {
    const r = await db.query('select now() as now, current_user as user, current_database() as db');
    res.json({ mode: 'pg', now: r.rows[0].now, user: r.rows[0].user, db: r.rows[0].db });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Export admin =====
app.get('/api/admin/export', async (req, res) => {
  try {
    await ensureDbSetup();
    const r = await db.query('SELECT tmdb_id, title, year, link FROM public.movies ORDER BY tmdb_id DESC LIMIT 500 OFFSET 0');
    res.json({ count: r.rowCount, items: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

// ===== Añadir/actualizar =====
app.post('/api/admin/add', adminGuard, async (req, res) => {
  try {
    await ensureDbSetup();

    let { tmdbId, title, year, link } = req.body;
    title = (title || '').trim();
    year = year ? parseInt(year, 10) : null;
    link = (link == null ? '' : String(link)); // permite vacío

    if (!tmdbId && !title) {
      return res.status(400).json({ error: 'Indica tmdbId o título' });
    }

    let tmdb_id = tmdbId ? parseInt(tmdbId, 10) : null;

    // Si falta tmdbId, intenta buscarlo en TMDB con título/año
    if (!tmdb_id && title && TMDB_API_KEY && !NO_TMDB) {
      const found = await tmdbSearchMovieByTitleYear(title, year).catch(() => null);
      if (found && found.id) {
        tmdb_id = found.id;
        if (!year && found.release_date) {
          const y = Number(found.release_date.slice(0,4));
          if (!isNaN(y)) year = y;
        }
        if (!title && found.title) title = found.title;
      }
    }

    // Si aún no hay tmdb_id, genera uno manual (negativo)
    if (!tmdb_id) {
      tmdb_id = await getManualId();
    }

    await db.query(
      `INSERT INTO public.movies (tmdb_id, title, year, link)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tmdb_id) DO UPDATE
         SET title = EXCLUDED.title,
             year  = EXCLUDED.year,
             link  = EXCLUDED.link
       RETURNING tmdb_id`,
      [tmdb_id, title, year, link]
    );

    res.json({ ok: true, tmdb_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo añadir' });
  }
});

// ===== Catálogo =====
app.get('/api/movies', async (req, res) => {
  try {
    await ensureDbSetup();

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.max(parseInt(req.query.pageSize || '24', 10), 1);
    const q = (req.query.q || '').toLowerCase().trim();

    const where = [];
    const params = [];
    if (q) {
      where.push(`LOWER(title) LIKE $${params.length+1}`);
      params.push('%' + q + '%');
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const totalRow = await db.query(`SELECT COUNT(*)::int AS c FROM public.movies ${whereSql}`, params);
    const total = totalRow.rows[0].c;

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.query(
      `SELECT tmdb_id, title, year, link
         FROM public.movies
         ${whereSql}
         ORDER BY tmdb_id DESC
         LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    // enriquecer sin romper
    let details = await Promise.allSettled(rows.rows.map(r => safeDetails(r.tmdb_id)));
    details = details.map(d => (d.status === 'fulfilled' ? d.value : null));

    const items = rows.rows.map((r, i) => ({
      ...r,
      poster_path: details[i]?.poster_path || null
    }));

    res.json({ total, page, pageSize, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo listar' });
  }
});

app.listen(PORT, () => {
  console.log('Servidor en http://0.0.0.0:' + PORT);
});
