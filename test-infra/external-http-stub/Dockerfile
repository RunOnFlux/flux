FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

EXPOSE 3000 3001

CMD ["node", "index.js"]
