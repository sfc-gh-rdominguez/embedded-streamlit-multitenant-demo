FROM oven/bun:1

WORKDIR /app

COPY package.json ./
RUN bun install

COPY server.ts ./

EXPOSE 8090
CMD ["bun", "server.ts"]
