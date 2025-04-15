FROM node:20-slim

# Install dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg wget && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory and non-root user
RUN mkdir -p /app/uploads && \
    groupadd -r offmute && \
    useradd -r -g offmute -d /app offmute && \
    chown -R offmute:offmute /app

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source files
COPY . .

# Create uploads directory with proper permissions
RUN chown -R offmute:offmute /app

# Switch to non-root user
USER offmute

# Build the application
RUN npm run build

# Set environment variables
ENV NODE_ENV=production

# Expose correct port (6543 from API code)
EXPOSE 6543

CMD ["node", "dist/api.js"]