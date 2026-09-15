FROM oven/bun:1

WORKDIR /app

COPY package.json ./
RUN bun install

COPY src ./src

EXPOSE 8001
CMD ["bun", "run", "src/server.ts"]
