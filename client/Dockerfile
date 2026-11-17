# Dialed: one Node server (pages, API, MCP and the scheduler), SQLite on a volume by default.
#   docker build -t dialed .
#   docker run -p 3000:3000 -v dialed-data:/data -e APP_SECRET=... -e APP_URL=http://localhost:3000 dialed
# Set DATABASE_URL=postgres://... to use Postgres instead. Migrations run when the server starts.

FROM node:24-slim AS deps
WORKDIR /app
# better-sqlite3 downloads a prebuilt binary; the build tools are there in case it has to compile.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_REPO_URL=https://github.com/saimulft/visual-api-tester
ENV NEXT_PUBLIC_REPO_URL=$NEXT_PUBLIC_REPO_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/dialed.db
# The standalone server, its static files and public/, owned by the non-root node user.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
