async function fetchGenres() {
  const res = await fetch('/api/genres');
  if (!res.ok) return alert('Error cargando géneros');
  const genres = await res.json();
  const genreSelect = document.getElementById('genreSelect');
  genres.forEach(g => {
    const option = document.createElement('option');
    option.value = g.id;
    option.textContent = g.name;
    genreSelect.appendChild(option);
  });
}

async function fetchMovies(genreId) {
  const url = genreId ? `/api/movies?genre=${genreId}` : '/api/movies';
  const res = await fetch(url);
  if (!res.ok) return alert('Error cargando las películas');
  const movies = await res.json();
  displayMovies(movies.items);
}

function displayMovies(movies) {
  const moviesList = document.getElementById('movies-list');
  moviesList.innerHTML = '';
  movies.forEach(movie => {
    const movieItem = document.createElement('div');
    movieItem.classList.add('movie-item');
    movieItem.innerHTML = `
      <img src="https://image.tmdb.org/t/p/w200${movie.poster_path}" alt="${movie.title}">
      <div class="movie-details">
        <h3>${movie.title} (${movie.year})</h3>
        <a href="${movie.link.replace('/api/', '/u/')}" target="_blank">Ver película</a>
      </div>
    `;
    moviesList.appendChild(movieItem);
  });
}

document.getElementById('genreSelect').addEventListener('change', function() {
  const selectedGenre = this.value;
  fetchMovies(selectedGenre);
});

// Initial load of genres and movies
fetchGenres();
fetchMovies();
