# Build context is the repo ROOT: docker build -f packages/rentflow-agent/Dockerfile .
FROM node:24-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY packages/landlord-server/package.json packages/landlord-server/
COPY packages/rentflow-agent/package.json packages/rentflow-agent/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci

COPY . .
RUN npm run build:shared

ENV NODE_ENV=production
# Run the accelerated loop automatically when deployed.
ENV RENTFLOW_AUTOSTART=true
EXPOSE 4022
CMD ["node", "--import", "tsx", "packages/rentflow-agent/src/index.ts"]
