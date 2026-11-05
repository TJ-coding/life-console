# ---- build the app ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- run: Node server serves the app, the sync API and Web Push ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=80 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY --from=build /app/dist ./dist
# planner data, push subscriptions and VAPID keys live here — mount a persistent volume
VOLUME /data
EXPOSE 80
# Swarm only routes traffic to a healthy task, so check soon after start
HEALTHCHECK --interval=10s --start-period=3s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1
CMD ["node", "server/server.mjs"]
