# Cine Castellano HD (Telegram WebApp)
Catálogo tipo Netflix con búsqueda por título/actor, filtros por género, ficha con sinopsis/reparto desde TMDB y enlace Pixeldrain. Incluye panel **Admin** para altas diarias e importación masiva desde TXT.

## Puesta en marcha local
```bash
cp .env.example .env
# edita .env con tu TMDB_API_KEY y ADMIN_TOKEN
npm install
npm start
# http://localhost:3000  (admin en /admin.html)
```

## Despliegue rápido
- **Railway/Render**: conecta tu repo, define variables `TMDB_API_KEY` y `ADMIN_TOKEN` (y opcional `DB_PATH` para persistencia).

## Telegram
En @BotFather: `/setdomain` con tu URL pública y `/setmenubutton` → web_app a `https://TU_URL/`.

### Persistencia en Railway
Si usas un **Volume** en Railway, añade `DB_PATH=/app/storage/db.sqlite` en Variables y monta el volumen en `/app/storage` para no perder la base entre deploys.
