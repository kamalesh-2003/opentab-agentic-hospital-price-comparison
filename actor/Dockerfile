# Build stage: compile TypeScript
FROM apify/actor-node:22 AS builder
COPY package*.json ./
RUN npm install --include=dev --audit=false
COPY . ./
RUN npm run build

# Runtime stage: production deps + compiled JS only
FROM apify/actor-node:22
COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional --audit=false \
    && echo "Installed NPM packages:" && (npm list --omit=dev --all || true)
COPY --from=builder /usr/src/app/dist ./dist
COPY . ./
CMD npm run start --silent
