# The app image (ADR-001 a, ADR-006 c): one container serving IF-001 and the built client.
# HUMAN-AUTHORED delivery file (S-GEN-025). node:22-slim pinned by digest (S-SEC-009).
FROM node@sha256:66cb8ef75184df13dc0dcf866330488996b485d404db60555756865300ced4a5 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY client/package.json client/
COPY backend/package.json backend/
COPY label-reader/package.json label-reader/
RUN npm ci --no-audit --no-fund
COPY client client
COPY backend backend
COPY label-reader label-reader
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node@sha256:66cb8ef75184df13dc0dcf866330488996b485d404db60555756865300ced4a5
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/label-reader/package.json label-reader/
COPY --from=build /app/label-reader/dist label-reader/dist
COPY --from=build /app/backend/package.json backend/
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/migrations backend/migrations
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
