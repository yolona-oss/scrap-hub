# Multi-stage Dockerfile for the telegram-ui-app example.
# Builds the hub gateway + Telegram UI into a single Node image.

FROM node:20-alpine AS build
WORKDIR /app

# Copy root workspace config so npm sees the whole monorepo graph during install.
COPY package.json package-lock.json tsconfig.base.json ./

# Copy only the packages + examples needed for the build. Skip packages/app
# (removed in the rewrite) and packages/org-scraper (lives separately in
# examples/scraper-node).
COPY packages/cmd-hub ./packages/cmd-hub
COPY packages/cmd-node ./packages/cmd-node
COPY packages/create-cmd-node ./packages/create-cmd-node
COPY examples/telegram-ui-app ./examples/telegram-ui-app

RUN npm ci --include=dev --ignore-scripts
RUN npm run build --workspace=@cmd-hub/core
RUN npm run build --workspace=telegram-ui-app


FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy only what the runtime needs: the workspace structure, node_modules,
# and the built JS under examples/telegram-ui-app.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/cmd-hub/build ./packages/cmd-hub/build
COPY --from=build /app/packages/cmd-hub/package.json ./packages/cmd-hub/package.json
COPY --from=build /app/packages/cmd-node/package.json ./packages/cmd-node/package.json
COPY --from=build /app/examples/telegram-ui-app/build ./examples/telegram-ui-app/build
COPY --from=build /app/examples/telegram-ui-app/package.json ./examples/telegram-ui-app/package.json

# The node:20-alpine base image already provides an unprivileged 'node' user
# (uid 1000). Drop to it so the process can't do anything privileged even if
# a vulnerability is found in the app layer.
RUN chown -R node:node /app
USER node

EXPOSE 50051 3000
CMD ["node", "examples/telegram-ui-app/build/src/index.js"]
