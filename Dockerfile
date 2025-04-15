FROM node:20-slim

# Set environment variables
ENV NODE_ENV=production
ENV PORT=6543
ENV HOME=/app

# Add non-root user first (before installing packages)
RUN mkdir -p /app/uploads && \
    groupadd -r offmute && \
    useradd -r -g offmute -d /app offmute && \
    chown -R offmute:offmute /app

# Install dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg wget ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    # Set strict permissions on system files
    chmod a-w -R /etc /lib /bin /usr/bin /usr/lib /usr/share

WORKDIR /app

# Copy package files
COPY --chown=offmute:offmute package*.json ./

# Install ALL dependencies (including dev dependencies) for build process
RUN npm install

# Copy source files
COPY --chown=offmute:offmute . .

# Build the application
RUN npm run build && \
    # Clean up dev dependencies after build
    npm prune --production && \
    # Remove unnecessary files to reduce attack surface
    rm -rf .git .github tests && \
    npm cache clean --force

# Create uploads directory with proper permissions
RUN mkdir -p /app/uploads && \
    chown -R offmute:offmute /app && \
    # Set appropriate permissions
    chmod -R 755 /app && \
    chmod -R 770 /app/uploads

# Switch to non-root user
USER offmute

# Expose correct port
EXPOSE 6543

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:6543/health || exit 1

CMD ["node", "dist/api.js"]