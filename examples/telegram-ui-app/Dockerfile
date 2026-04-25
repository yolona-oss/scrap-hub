FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./

COPY packages/cmd-hub-common      ./packages/cmd-hub-common
COPY packages/cmd-hub-transport   ./packages/cmd-hub-transport
COPY packages/cmd-hub-storage-mongo ./packages/cmd-hub-storage-mongo
COPY packages/cmd-hub             ./packages/cmd-hub
COPY packages/cmd-hub-ui-telegram ./packages/cmd-hub-ui-telegram
COPY examples/telegram-ui-app     ./examples/telegram-ui-app

RUN npm ci --include=dev --ignore-scripts
RUN npm run build --workspace=@cmd-hub/common
RUN npm run build --workspace=@cmd-hub/transport
RUN npm run build --workspace=@cmd-hub/storage-mongo
RUN npm run build --workspace=@cmd-hub/core
RUN npm run build --workspace=@cmd-hub/ui-telegram
RUN npm run build --workspace=telegram-ui-app


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
COPY --from=build /app/packages/cmd-hub-ui-telegram/build  ./packages/cmd-hub-ui-telegram/build
COPY --from=build /app/packages/cmd-hub-ui-telegram/package.json ./packages/cmd-hub-ui-telegram/package.json

COPY --from=build /app/examples/telegram-ui-app/build      ./examples/telegram-ui-app/build
COPY --from=build /app/examples/telegram-ui-app/package.json ./examples/telegram-ui-app/package.json

RUN chown -R node:node /app
USER node

EXPOSE 50051 8081
CMD ["node", "examples/telegram-ui-app/build/index.js", "/config/config.json"]
