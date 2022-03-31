FROM timbru31/node-alpine-git

WORKDIR ~/hns-bridge

COPY . .

RUN npm install && npm install -g pm2 node-gyp

EXPOSE 80

CMD ["pm2-runtime", "app.js"]