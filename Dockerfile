# Playwright base image already includes Chromium
FROM apify/actor-node-playwright:latest

# Install deps (no dev)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy app
COPY . ./

# Default command
CMD [ "node", "src/main.js" ]