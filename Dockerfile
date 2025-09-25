FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Installera Chromium + systemdeps för Playwright
RUN npx playwright install --with-deps chromium

EXPOSE 3000
CMD ["npm", "start"]
