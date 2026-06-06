FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

EXPOSE 16130 16131

CMD ["node", "index.js"]
