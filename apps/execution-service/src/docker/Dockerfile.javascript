FROM node:18-alpine

RUN addgroup -S runner && adduser -S -G runner -u 10001 runner

WORKDIR /app
USER runner

CMD ["node", "/app/code.js"]