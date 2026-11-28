# syntax=docker/dockerfile:1
# One image build for every server-side app (ADR-0017). Targets: api, worker, business, admin.
#   docker build --target api -t jays-api .
# The runtime images carry the built workspace. No secrets are baked in: configuration comes
# from the environment at run time and is validated at startup (ADR-0006).

FROM node:22.22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jays/api --filter @jays/worker --filter @jays/business --filter @jays/admin build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node

FROM runtime AS api
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]

FROM runtime AS worker
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

FROM runtime AS business
WORKDIR /app/apps/business
EXPOSE 3001
CMD ["node_modules/.bin/next", "start", "--port", "3001"]

FROM runtime AS admin
WORKDIR /app/apps/admin
EXPOSE 3002
CMD ["node_modules/.bin/next", "start", "--port", "3002"]
