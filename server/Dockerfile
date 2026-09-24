FROM node:22-alpine

RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile
COPY server ./server

WORKDIR /app/server
EXPOSE 3000
CMD ["pnpm", "start"]
