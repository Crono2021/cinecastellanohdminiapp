
app.post('/admin/bulk-import', (req, res) => {
  const token = req.headers.authorization;
  if (token !== process.env.ADMIN_TOKEN) return res.status(403).send('Token inválido');

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
