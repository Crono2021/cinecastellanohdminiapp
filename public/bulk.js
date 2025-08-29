
function parseMovies(input) {
    const regex = /\[(.+?) \((\d{4})\)\]\((https?:\/\/[^\s]+)\)/g;
    let match;
    const movies = [];

    while ((match = regex.exec(input)) !== null) {
        movies.push({
            title: match[1],
            year: parseInt(match[2]),
            link: match[3]
        });
    }

    return movies;
}

async function submitBulk() {
    const token = document.getElementById('token').value;
    const input = document.getElementById('bulkInput').value;
    const movies = parseMovies(input);

    const responseBox = document.getElementById('response');
    responseBox.textContent = 'Enviando datos...';

    try {
        const response = await fetch('/admin/bulk-import', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            },
            body: JSON.stringify({ movies })
        });

        const result = await response.text();
        responseBox.textContent = result;
    } catch (error) {
        responseBox.textContent = 'Error al importar películas.';
    }
}
