
// Detenemos el comportamiento de retroceso físico en Android.
document.addEventListener('backbutton', function(event) {
    if (window.location.hash === "#ficha") {
        event.preventDefault(); // Prevenir la acción predeterminada (salir de la app).
        window.history.replaceState(null, "", "#menu"); // Reemplazamos el historial con el menú.
        showMenu(); // Mostrar el menú.
    }
}, false);

// Manejamos el cambio de historial cuando el usuario navega entre el menú y la ficha
window.addEventListener('popstate', function(event) {
    if (window.location.hash === "#ficha") {
        event.preventDefault();  // Prevenir la acción de retroceder.
        window.history.replaceState(null, "", "#menu"); // Retroceder al menú sin añadir una nueva entrada al historial.
        showMenu(); // Mostrar el menú.
    }
}, false);

// Función para mostrar el menú
function showMenu() {
    document.getElementById('menu').style.display = 'block';
    document.getElementById('ficha').style.display = 'none';
}

// Función para ir a la ficha
function goToFicha() {
    window.history.pushState(null, "", "#ficha"); // Añadir al historial la vista ficha
    document.getElementById('ficha').style.display = 'block';
    document.getElementById('menu').style.display = 'none';
}

// Función para regresar al menú
function goBackToMenu() {
    window.history.pushState(null, "", "#menu"); // Añadir al historial la vista menú
    showMenu();
}
