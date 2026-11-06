FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
  && pnpm config set fetch-timeout 600000 \
  && pnpm config set network-concurrency 4 \
  && pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate \
  && pnpm build \
  && SOURCE_NEXT="$(dirname "$(readlink -f node_modules/next/package.json)")" \
  && TARGET_NEXT="$(dirname "$(find .next/standalone/node_modules/.pnpm -path '*/node_modules/next/package.json' -print -quit)")" \
  && test -n "$TARGET_NEXT" \
  && cp -R "$SOURCE_NEXT/." "$TARGET_NEXT/"

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p .data/storage && chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
