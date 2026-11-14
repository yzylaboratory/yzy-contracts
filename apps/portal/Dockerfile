FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS dependencies
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/portal/package.json apps/portal/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/portal apps/portal
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/portal/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=build --chown=node:node /app/apps/portal/public ./apps/portal/public
USER node
EXPOSE 3000
CMD ["node", "apps/portal/server.js"]
