# Use Apify's base image with Puppeteer
FROM apify/actor-node-puppeteer-chrome:20

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --omit=optional || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy source code
COPY . ./

# Run the actor
CMD npm start
