
// Get token and assign it to request headers
document.getElementById('saveToken').addEventListener('click', function () {
  localStorage.setItem('adminToken', document.getElementById('token').value);
});

// Handle adding a single movie by TMDB ID or by title and year
document.getElementById('addOne').addEventListener('click', async function () {
  const title = document.getElementById('title').value.trim();
  const year = document.getElementById('year').value.trim();
  const link = document.getElementById('link').value.trim();
  const tmdbId = document.getElementById('tmdbId').value.trim();

  if (tmdbId) {
    const response = await fetch('/api/admin/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('adminToken'),
      },
      body: JSON.stringify({ tmdbId }),
    });
    const data = await response.json();
    document.getElementById('oneOut').innerText = data.message || 'Película añadida exitosamente';
  } else if (title && year && link) {
    const response = await fetch('/api/admin/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('adminToken'),
      },
      body: JSON.stringify({ title, year, link }),
    });
    const data = await response.json();
    document.getElementById('oneOut').innerText = data.message || 'Película añadida exitosamente';
  } else {
    alert('Por favor, complete los campos necesarios');
  }
});

// Handle bulk movie import
document.getElementById('doBulk').addEventListener('click', async function () {
  const bulkText = document.getElementById('bulk').value.trim();
  if (!bulkText) {
    alert('Por favor, ingresa el texto con las películas');
    return;
  }

  const lines = bulkText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const movies = [];

  for (const line of lines) {
    const regex = /\[(.*?)\]\((https:\/\/pixeldrain\.net\/[^\)]+)\)/;
    const match = line.match(regex);
    if (match) {
      const title = match[1];
      const link = match[2];
      const yearMatch = title.match(/\((\d{4})\)/);
      const year = yearMatch ? yearMatch[1] : null;

      movies.push({ title, year, link });
    }
  }

  if (movies.length === 0) {
    alert('No se encontró ninguna película válida en el texto.');
    return;
  }

  // Send the movies to the backend
  const response = await fetch('/api/admin/bulkImport', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + localStorage.getItem('adminToken'), // Token from localStorage
    },
    body: JSON.stringify({ text: bulkText })
  });

  const data = await response.json();
  let result = 'Películas importadas: ' + data.imported + '<br>';
  if (data.errors.length > 0) {
    result += 'Errores: <br>' + data.errors.join('<br>');
  }
  document.getElementById('bulkOut').innerHTML = result;
});
