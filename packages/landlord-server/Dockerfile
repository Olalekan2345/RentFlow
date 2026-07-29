# Build context is the repo ROOT: docker build -f packages/landlord-server/Dockerfile .
FROM node:24-slim
WORKDIR /app

# Install workspace deps (copy manifests first for layer caching).
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY packages/landlord-server/package.json packages/landlord-server/
COPY packages/rentflow-agent/package.json packages/rentflow-agent/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci

# Copy source and build the shared package (consumers import its dist/).
COPY . .
RUN npm run build:shared

ENV NODE_ENV=production
# Cloud hosts inject $PORT; landlord config prefers it over LANDLORD_PORT.
EXPOSE 4021
CMD ["node", "--import", "tsx", "packages/landlord-server/src/index.ts"]
