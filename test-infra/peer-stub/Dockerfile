# The Arcane link arithmetic comes out of the node image: the stub authenticates
# with FluxOS's own linkCrypto.js, so it cannot drift from the node it talks to.
# That makes flux-e2e-fluxos-01 a build dependency of this stub - build-images.sh
# builds it first and passes its tag through.
ARG FLUX_E2E_TAG=latest
FROM flux-e2e-fluxos-01:${FLUX_E2E_TAG} AS nodeimage

FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./
COPY --from=nodeimage /flux/ZelBack/src/services/utils/linkCrypto.js ./linkCrypto.js

EXPOSE 16127 16128

CMD ["node", "index.js"]
