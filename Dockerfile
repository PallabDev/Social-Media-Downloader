FROM node:20-alpine AS base

# Install ffmpeg and yt-dlp dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
    libffi-dev \
    openssl-dev \
    gcc \
    musl-dev \
    g++ \
    make

# Install yt-dlp
RUN pip3 install --break-system-packages yt-dlp

# Verify installations
RUN ffmpeg -version && yt-dlp --version

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
    libffi-dev \
    openssl-dev \
    gcc \
    musl-dev \
    g++ \
    make

RUN pip3 --break-system-packages install yt-dlp

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=base /app/public ./public
COPY --from=base --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=base --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/downloads && chown nextjs:nodejs /app/downloads

USER nextjs

EXPOSE 8733

ENV PORT=8733
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
