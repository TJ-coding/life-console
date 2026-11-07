# Life Console: one image for the app (default) and the backup job (`node server/backup.mjs`).
# ---- build the front end ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- run ----
FROM node:22-alpine
# pg_dump for pre-migration and scheduled backups; its major version must be >= the database's
ARG PG_CLIENT=17
RUN apk add --no-cache postgresql${PG_CLIENT}-client
ENV NODE_ENV=production PORT=8080 BACKUP_DIR=/backups
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /backups && chown node:node /backups
USER node
EXPOSE 8080
# orchestrators (Swarm/Dokploy, compose) only route to a healthy container; /api/health also checks the database
HEALTHCHECK --interval=10s --start-period=20s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/server.mjs"]
