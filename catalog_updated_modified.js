
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
      <div>${movie.title}</div>
    `;
    moviesList.appendChild(movieItem);
  });
}

window.onpopstate = function(event) {
    if (window.location.hash === "#ficha") {
        window.history.pushState(null, "", "#menu");
        showMenu();
    }
};

function showMenu() {
    document.getElementById('menu').style.display = 'block';
    document.getElementById('ficha').style.display = 'none';
}

function goBackToMenu() {
    window.history.pushState(null, "", "#menu");
    showMenu();
}

function goToFicha() {
    window.history.pushState(null, "", "#ficha");
    document.getElementById('ficha').style.display = 'block';
    document.getElementById('menu').style.display = 'none';
}
