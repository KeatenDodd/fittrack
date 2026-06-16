# FitTrack — single self-contained image. Embedded SQLite, no external database.
# Node 22+ is required for the built-in node:sqlite module.
FROM node:22-alpine

WORKDIR /app

# Install runtime dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
# Plain HTTP inside the container; you reach it at http://localhost:1308, which
# browsers treat as a secure context so the camera/barcode scanner still works.
ENV PORT=1308
ENV HOST=0.0.0.0
# All data (SQLite db + uploads) lives here; mount a volume to persist it.
ENV DATA_DIR=/data
EXPOSE 1308

CMD ["node", "src/server.js"]
