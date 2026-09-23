FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY healthcheck.mjs ./healthcheck.mjs
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "src/server.mjs"]
