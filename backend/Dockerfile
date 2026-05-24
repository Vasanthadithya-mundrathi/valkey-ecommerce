FROM node:20-alpine

WORKDIR /app

# Install only production deps for a slim image. Source comes next so the
# layer above is cached when only code changes.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/server.js"]
