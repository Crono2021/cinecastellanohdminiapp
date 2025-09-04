/* server.js (simple, solo Postgres Supabase)
 * Variables de entorno necesarias en Render:
 *  - PORT (opcional, por defecto 3000)
 *  - DATABASE_URL  (URI del pooler de Supabase, con contraseña codificada)
 *  - ADMIN_TOKEN   (token para /api/admin/*)
 *  - TMDB_API_KEY  (opcional, para enriquecer; aquí no la usamos para simplificar)
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en variables de entorno');
  process.exit(1);
}

// Pool Postgres (acepta el cert de Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helpers DB
const db = {
  query: (text, params=[]) => pool.query(text, params)
};

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function adminGuard(req, res, next) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Salud
app.get('/health/db', async (req, res) => {
  try {
    const r = await db.query('select now() as now, current_user as user, current_database() as db');
    res.json({ mode: 'pg', now: r.rows[0].now, user: r.rows[0].user, db: r.rows[0].db });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export simple (lista últimas 500)
app.get('/api/admin/export', async (req, res) => {
  try {
    const r = await db.query('SELECT tmdb_id, title, year, link FROM public.movies ORDER BY tmdb_id DESC LIMIT 500 OFFSET 0');
    res.json({ count: r.rowCount, items: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

// Añadir/actualizar (UPSERT nativo)
app.post('/api/admin/add', adminGuard, async (req, res) => {
  try {
    const { tmdbId, title, year, link } = req.body;
    if (!tmdbId || !link) return res.status(400).json({ error: 'tmdbId y link son obligatorios' });
    const tmdb_id = parseInt(tmdbId, 10);
    const realTitle = title || '';
    const realYear = year ? parseInt(year, 10) : null;

    await db.query(
      `INSERT INTO public.movies (tmdb_id, title, year, link)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tmdb_id) DO UPDATE
         SET title = EXCLUDED.title,
             year  = EXCLUDED.year,
             link  = EXCLUDED.link
       RETURNING tmdb_id`,
      [tmdb_id, realTitle, realYear, link]
    );

    res.json({ ok: true, tmdb_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Catálogo simple (sin TMDB, devuelve JSON puro)
app.get('/api/movies', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.max(parseInt(req.query.pageSize || '24', 10), 1);
    const q = (req.query.q || '').toLowerCase().trim();

    const where = [];
    const params = [];
    if (q) {
      where.push('LOWER(title) LIKE $' + (params.length + 1));
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

    res.json({ total, page, pageSize, items: rows.rows });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo listar' });
  }
});

// Arranque
app.listen(PORT, () => {
  console.log('Servidor escuchando en http://0.0.0.0:' + PORT);
});
