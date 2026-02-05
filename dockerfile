# ---- base ----
FROM node:20-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps ----
FROM base AS deps
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV NO_PROXY=$NO_PROXY
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build ----
FROM base AS builder
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_CLIENT_CODE
ARG NEXT_PUBLIC_COMPANY_CODE
ARG NEXT_PUBLIC_GAME_CODE
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_CLIENT_CODE=$NEXT_PUBLIC_CLIENT_CODE
ENV NEXT_PUBLIC_COMPANY_CODE=$NEXT_PUBLIC_COMPANY_CODE
ENV NEXT_PUBLIC_GAME_CODE=$NEXT_PUBLIC_GAME_CODE
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV NO_PROXY=$NO_PROXY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# Copiamos el standalone server y assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
