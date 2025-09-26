FROM mcr.microsoft.com/playwright:v1.47.2-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm","start"]
