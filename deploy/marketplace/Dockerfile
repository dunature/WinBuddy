FROM oven/bun:1.3.13-alpine
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
CMD ["bun", "run", "--filter=@proma/marketplace-api", "start"]
