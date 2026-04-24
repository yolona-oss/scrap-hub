FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci --ignore-scripts || npm install --ignore-scripts
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build ./build

# Drop to an unprivileged user. node:20-alpine ships a `node` user at uid 1000.
RUN chown -R node:node /app
USER node

EXPOSE 50052
CMD ["node", "build/src/index.js"]
