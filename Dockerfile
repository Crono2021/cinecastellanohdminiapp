FROM node:20-bullseye-slim

WORKDIR /app

# Instala dependencias (sqlite3 suele ser mucho más estable en Debian slim que en Alpine)
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node","server.js"]
