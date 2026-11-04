FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV HOST=0.0.0.0
USER node
EXPOSE 3000
CMD ["npm","start"]
