# Changelog

## 1.1.0
- Catálogo oculto de series en /series
- Importación de series en Admin con formato: `Título (año) | Payload`
- Botón Reproducir abre Telegram con deep-link `start=` (payload) para disparar /start PAYLOAD en el bot

## 1.2.3
- Corrige modo /series: ficha y reproducir usan /api/tv y Telegram payload
- /api/catalog respeta type=tv|movie para Explorar
- Top de series se registra con type tv al reproducir

