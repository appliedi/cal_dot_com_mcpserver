# ---- Build Stage ----
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files separately for better caching
COPY package*.json tsconfig.json ./

# Install all dependencies (including dev)
RUN npm install

# Copy rest of the source code
COPY . .

# Build TypeScript project
RUN npm run build

# ---- Production Stage ----
FROM node:18-alpine AS release

WORKDIR /app

ENV NODE_ENV=production

# Copy built code and package files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Expose port (optional but recommended)
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]
