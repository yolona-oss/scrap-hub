# Multi-stage Dockerfile for the scraper-node example.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/cmd-hub ./packages/cmd-hub
COPY packages/cmd-node ./packages/cmd-node
COPY packages/create-cmd-node ./packages/create-cmd-node
COPY examples/scraper-node ./examples/scraper-node

RUN npm ci --include=dev --ignore-scripts
RUN npm run build --workspace=@cmd-hub/core
RUN npm run build --workspace=cmd-node
RUN npm run build --workspace=scraper-node


FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/cmd-hub/build ./packages/cmd-hub/build
COPY --from=build /app/packages/cmd-hub/package.json ./packages/cmd-hub/package.json
COPY --from=build /app/packages/cmd-node/build ./packages/cmd-node/build
COPY --from=build /app/packages/cmd-node/package.json ./packages/cmd-node/package.json
COPY --from=build /app/examples/scraper-node/build ./examples/scraper-node/build
COPY --from=build /app/examples/scraper-node/package.json ./examples/scraper-node/package.json

# Drop privileges — see telegram-ui-app/Dockerfile for the rationale.
RUN chown -R node:node /app
USER node

EXPOSE 50052
CMD ["node", "examples/scraper-node/build/src/index.js"]
