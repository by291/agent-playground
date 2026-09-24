FROM node:22-alpine

RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile
COPY web ./web

WORKDIR /app/web
EXPOSE 5173
CMD ["pnpm", "dev"]
