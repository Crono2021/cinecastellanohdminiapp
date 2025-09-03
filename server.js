
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.get('/download-db', (req, res) => {
  const filePath = '/app/storage/db.sqlite';  // Ruta donde se encuentra el archivo en Railway
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'db.sqlite', (err) => {
      if (err) {
        console.log('Error al descargar el archivo:', err);
        res.status(500).send('Error al descargar el archivo');
      }
    });
  } else {
    res.status(404).send('Archivo no encontrado');
  }
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
