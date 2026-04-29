FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

EXPOSE 8384 8385

CMD ["node", "index.js"]
