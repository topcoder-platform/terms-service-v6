FROM node:26.13.1-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts/package-core-runtime.mjs ./scripts/package-core-runtime.mjs
RUN npm run build && npm prune --omit=dev --omit=optional --ignore-scripts \
    && node scripts/package-core-runtime.mjs

FROM alpine:3.24 AS runtime
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates 'nodejs-current~26' 'nodejs-current>=26.13.1-r0' 'libcrypto3>=3.5.9-r1' 'libssl3>=3.5.9-r1' 'zlib>=1.4-r0' \
    && addgroup -S -g 1000 node \
    && adduser -S -D -u 1000 -G node node
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docs ./docs
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
