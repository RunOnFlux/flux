FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

EXPOSE 16124 16224 18232

CMD ["node", "index.js"]
