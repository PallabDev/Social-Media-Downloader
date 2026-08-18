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

# Install yt-dlp + curl_cffi + bgutil PO Token provider plugin
RUN pip3 install --break-system-packages 'yt-dlp' 'curl_cffi<0.7' 'bgutil-ytdlp-pot-provider'

# Verify installations
RUN ffmpeg -version && yt-dlp --version

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

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

# Install yt-dlp + curl_cffi + bgutil PO Token provider plugin
RUN pip3 install --break-system-packages 'yt-dlp' 'curl_cffi<0.7' 'bgutil-ytdlp-pot-provider'

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=base /app/public ./public
COPY --from=base --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=base --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/downloads && chown nextjs:nodejs /app/downloads
RUN mkdir -p /app/logs && chown nextjs:nodejs /app/logs

USER nextjs

EXPOSE 8733

ENV PORT=8733
ENV HOSTNAME="0.0.0.0"
ENV LOG_DIR=/app/logs
ENV LOG_LEVEL=info

CMD ["node", "server.js"]
