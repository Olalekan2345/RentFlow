# Build context is the repo ROOT: docker build -f packages/dashboard/Dockerfile .
FROM node:24-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY packages/landlord-server/package.json packages/landlord-server/
COPY packages/rentflow-agent/package.json packages/rentflow-agent/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci

COPY . .

# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so the public
# agent URL must be known here. Pass it as a build arg.
ARG NEXT_PUBLIC_AGENT_URL=http://localhost:4022
ARG NEXT_PUBLIC_LANDLORD_URL=http://localhost:4021
ENV NEXT_PUBLIC_AGENT_URL=$NEXT_PUBLIC_AGENT_URL
ENV NEXT_PUBLIC_LANDLORD_URL=$NEXT_PUBLIC_LANDLORD_URL

RUN npm run build:shared && npm run build -w packages/dashboard

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "packages/dashboard"]
