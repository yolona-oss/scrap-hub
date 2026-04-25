FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./

COPY packages/cmd-hub-common      ./packages/cmd-hub-common
COPY packages/cmd-hub-transport   ./packages/cmd-hub-transport
COPY packages/cmd-hub-storage-mongo ./packages/cmd-hub-storage-mongo
COPY packages/cmd-hub             ./packages/cmd-hub
COPY packages/cmd-hub-node        ./packages/cmd-hub-node
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

COPY --from=build /app/packages/cmd-hub-common/build       ./packages/cmd-hub-common/build
COPY --from=build /app/packages/cmd-hub-common/package.json ./packages/cmd-hub-common/package.json
COPY --from=build /app/packages/cmd-hub-transport/build    ./packages/cmd-hub-transport/build
COPY --from=build /app/packages/cmd-hub-transport/package.json ./packages/cmd-hub-transport/package.json
COPY --from=build /app/packages/cmd-hub-storage-mongo/build ./packages/cmd-hub-storage-mongo/build
COPY --from=build /app/packages/cmd-hub-storage-mongo/package.json ./packages/cmd-hub-storage-mongo/package.json
COPY --from=build /app/packages/cmd-hub/build              ./packages/cmd-hub/build
COPY --from=build /app/packages/cmd-hub/package.json       ./packages/cmd-hub/package.json
COPY --from=build /app/packages/cmd-hub-node/build         ./packages/cmd-hub-node/build
COPY --from=build /app/packages/cmd-hub-node/package.json  ./packages/cmd-hub-node/package.json

COPY --from=build /app/examples/scraper-node/build         ./examples/scraper-node/build
COPY --from=build /app/examples/scraper-node/package.json  ./examples/scraper-node/package.json

RUN chown -R node:node /app
USER node

EXPOSE 50061
CMD ["node", "examples/scraper-node/build/index.js", "/config/config.json"]
