#!/usr/bin/env bash
#
# Regenerate the fleet's TLS material.
#
# Every server cert is bound to a stable DNS name, NOT an IP, so it holds under
# any subnet base: the container carries the matching network alias, Docker's
# embedded DNS answers it, and TLS verifies against the name.
#
#   fluxregistry          node dockerd pulls `fluxregistry:5000/...`; the host
#                         pushes to the registry's IP and verifies against
#                         servername fluxregistry (runner/framework/registry-helper.js)
#   storage.runonflux.io  the only address a storage link may name, served by
#                         the external HTTP stub so the fetch a node makes on a
#                         specification's behalf runs without leaving the fleet
#
# Outputs (committed): ca.pem, server-cert.pem, server-key.pem,
# storage-cert.pem, storage-key.pem. ca-key.pem is intermediate and removed
# here, so another cert under this CA means re-running this script and
# replacing every output together.
set -euo pipefail
cd "$(dirname "$0")"

REGISTRY_ALIAS=fluxregistry
STORAGE_ALIAS=storage.runonflux.io

# Self-signed CA (nodes trust ca.pem; dockerd loads it under certs.d/fluxregistry:5000/)
openssl genrsa -out ca-key.pem 4096
openssl req -x509 -new -nodes -key ca-key.pem -sha256 -days 3650 \
  -out ca.pem -subj "/CN=flux-e2e-test-ca"

# Server key + CSR, CN/SAN bound to the alias it is served under.
sign_for() {
  local name=$1 alias=$2
  openssl genrsa -out "${name}-key.pem" 4096
  openssl req -new -key "${name}-key.pem" -out "${name}.csr" -subj "/CN=${alias}"
  openssl x509 -req -in "${name}.csr" -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
    -out "${name}-cert.pem" -days 3650 -sha256 \
    -extfile <(printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$alias")
  rm -f "${name}.csr"
}

sign_for server "$REGISTRY_ALIAS"
sign_for storage "$STORAGE_ALIAS"

rm -f ca.srl ca-key.pem
echo "Regenerated CA + certs (SAN DNS:${REGISTRY_ALIAS}, DNS:${STORAGE_ALIAS})"
