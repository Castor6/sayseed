ARG NODE_VERSION=22.23.3
FROM node:${NODE_VERSION}-bookworm AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.4.1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sayseed/web build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
ARG RELEASE_VERSION=development
ARG RELEASE_COMMIT=unknown
ARG SOURCE_REPOSITORY=https://github.com/Castor6/sayseed
LABEL org.opencontainers.image.title="Sayseed" \
      org.opencontainers.image.source=$SOURCE_REPOSITORY \
      org.opencontainers.image.version=$RELEASE_VERSION \
      org.opencontainers.image.revision=$RELEASE_COMMIT
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 SAYSEED_DATA_DIR=/app/data
ENV SAYSEED_VERSION=$RELEASE_VERSION SAYSEED_COMMIT=$RELEASE_COMMIT
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
