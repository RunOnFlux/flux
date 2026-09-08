# The apt repository comes out of the node image rather than being rebuilt here:
# the packages this stub serves are then the same files the node was seeded with,
# and there is no second download that could resolve to different versions. That
# makes flux-e2e-fluxos-01 a build dependency of this stub - build-images.sh
# builds it first and passes its tag through.
ARG FLUX_E2E_TAG=latest
FROM flux-e2e-fluxos-01:${FLUX_E2E_TAG} AS nodeimage

FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

COPY --from=nodeimage /opt/flux-apt-repo /repo

EXPOSE 3000 3001

CMD ["node", "index.js"]
