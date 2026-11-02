FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN npm ci
COPY . .
RUN npm run build:server
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN npm ci --omit=dev --workspaces=false
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
CMD ["node", "dist/apps/api/src/main.js"]
