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
    make \
    git

# Install yt-dlp + curl_cffi + bgutil PO Token provider
RUN pip3 install --break-system-packages 'yt-dlp' 'curl_cffi<0.7' 'bgutil-ytdlp-pot-provider'

# Clone and build bgutil PO Token server (for script method)
RUN git clone --single-branch --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm ci \
    && npx tsc

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

# Install yt-dlp + curl_cffi + bgutil PO Token provider
RUN pip3 install --break-system-packages 'yt-dlp' 'curl_cffi<0.7' 'bgutil-ytdlp-pot-provider'

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=base /app/public ./public
COPY --from=base --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=base --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy bgutil PO Token server for script method
COPY --from=base /opt/bgutil /opt/bgutil

RUN mkdir -p /app/downloads && chown nextjs:nodejs /app/downloads
RUN mkdir -p /app/logs && chown nextjs:nodejs /app/logs

# Symlink bgutil for the nextjs user (script method default path)
RUN ln -sf /opt/bgutil /home/nextjs/bgutil-ytdlp-pot-provider

USER nextjs

EXPOSE 8733

ENV PORT=8733
ENV HOSTNAME="0.0.0.0"
ENV LOG_DIR=/app/logs
ENV LOG_LEVEL=info

CMD ["node", "server.js"]
