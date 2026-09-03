FROM node:22-slim

ENV NODE_ENV=development
WORKDIR /app

# Dépendances d'abord : la couche survit tant que package-lock.json ne bouge pas.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
