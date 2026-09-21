FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /srv
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --filter @cipherpad/server
COPY tsconfig.base.json ./
COPY packages/server packages/server
RUN pnpm --filter @cipherpad/server build
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
