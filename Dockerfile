FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY bin ./bin
COPY docker/entrypoint.sh /usr/local/bin/nerve-runtime-container

RUN chmod +x /usr/local/bin/nerve-runtime-container \
  && mkdir -p /workspace

ENV PORT=4190
ENV WS_PATH=/api/runtime/ws
ENV WORKSPACE_DIR=/workspace

EXPOSE 4190

ENTRYPOINT ["/usr/local/bin/nerve-runtime-container"]