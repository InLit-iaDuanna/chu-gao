FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
  && pnpm config set fetch-timeout 600000 \
  && pnpm config set network-concurrency 4 \
  && pnpm install --frozen-lockfile
ARG SOURCE_REV=dev
RUN echo "Building source revision ${SOURCE_REV}"
COPY . .
ARG BUILD_DATABASE_URL="postgresql://app:build@127.0.0.1:1/app?connect_timeout=1"
ENV DATABASE_URL=${BUILD_DATABASE_URL}
RUN pnpm db:generate \
  && pnpm build

FROM node:22-alpine AS runner
ARG SOURCE_REV
WORKDIR /app
LABEL org.opencontainers.image.revision=${SOURCE_REV}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p .data/storage && chown -R nextjs:nodejs /app/.data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
