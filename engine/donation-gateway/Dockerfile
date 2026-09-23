FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
EXPOSE 8090
CMD ["node", "src/server.mjs"]
