FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./

COPY packages/common      ./packages/common
COPY packages/transport   ./packages/transport
COPY plugins/storage/mongo ./plugins/storage/mongo
COPY packages/core             ./packages/core
COPY packages/node        ./packages/node
COPY examples/scraper-node        ./examples/scraper-node

RUN npm ci --include=dev --ignore-scripts
RUN npm run build --workspace=@cmd-hub/common
RUN npm run build --workspace=@cmd-hub/transport
RUN npm run build --workspace=@cmd-hub/storage-mongo
RUN npm run build --workspace=@cmd-hub/core
RUN npm run build --workspace=@cmd-hub/node
RUN npm run build --workspace=scraper-node


FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

COPY --from=build /app/packages/common/build       ./packages/common/build
COPY --from=build /app/packages/common/package.json ./packages/common/package.json
COPY --from=build /app/packages/transport/build    ./packages/transport/build
COPY --from=build /app/packages/transport/package.json ./packages/transport/package.json
COPY --from=build /app/plugins/storage/mongo/build ./plugins/storage/mongo/build
COPY --from=build /app/plugins/storage/mongo/package.json ./plugins/storage/mongo/package.json
COPY --from=build /app/packages/core/build              ./packages/core/build
COPY --from=build /app/packages/core/package.json       ./packages/core/package.json
COPY --from=build /app/packages/node/build         ./packages/node/build
COPY --from=build /app/packages/node/package.json  ./packages/node/package.json

COPY --from=build /app/examples/scraper-node/build         ./examples/scraper-node/build
COPY --from=build /app/examples/scraper-node/package.json  ./examples/scraper-node/package.json

RUN chown -R node:node /app
USER node

EXPOSE 50061
CMD ["node", "examples/scraper-node/build/index.js", "/config/config.json"]
