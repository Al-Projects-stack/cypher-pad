FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /srv
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/crypto/package.json packages/crypto/
COPY packages/crypto/tsconfig.json packages/crypto/
COPY packages/crypto/tsconfig.build.json packages/crypto/
COPY packages/crypto/src packages/crypto/src
COPY packages/client/package.json packages/client/
COPY packages/client/tsconfig.json packages/client/
COPY packages/client/index.html packages/client/
COPY packages/client/vite.config.ts packages/client/
COPY packages/client/public packages/client/public
COPY packages/client/src packages/client/src
RUN pnpm install --frozen-lockfile --filter @cipherpad/client
RUN pnpm --filter @cipherpad/crypto build
RUN pnpm --filter @cipherpad/client build

FROM nginx:1.27-alpine AS run
COPY packages/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/packages/client/dist /usr/share/nginx/html
EXPOSE 80
