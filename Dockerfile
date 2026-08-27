FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /data /data/sipa-fotos /data/sipa-retratos /data/profile-fotos && chown -R node:node /data /app
USER node
ENV NODE_ENV=production DATA_DIR=/data SIPA_PHOTOS_DIR=/data/sipa-fotos SIPA_PORTRAITS_DIR=/data/sipa-retratos PROFILE_PHOTOS_DIR=/data/profile-fotos PORT=8080 SERVER_BIND_ADDRESS=0.0.0.0
EXPOSE 8080
CMD ["node", "--no-warnings", "server.mjs"]
