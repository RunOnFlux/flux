#!/usr/bin/env bash
#
# Regenerate the test registry's TLS material.
#
# The server cert is bound to a stable DNS name (fluxregistry), NOT an IP, so the
# registry is reachable under any subnet base: the harness gives the registry
# container this network alias, node dockerd pulls `fluxregistry:5000/...` (Docker
# embedded DNS resolves the alias and TLS verifies against DNS:fluxregistry), and
# the host pushes to the registry's IP but verifies the cert against servername
# fluxregistry (see runner/framework/registry-helper.js).
#
# Outputs (committed): ca.pem, server-cert.pem, server-key.pem.
# ca-key.pem is intermediate only and not needed at runtime.
set -euo pipefail
cd "$(dirname "$0")"

ALIAS=fluxregistry

# Self-signed CA (nodes trust ca.pem; dockerd loads it under certs.d/fluxregistry:5000/)
openssl genrsa -out ca-key.pem 4096
openssl req -x509 -new -nodes -key ca-key.pem -sha256 -days 3650 \
  -out ca.pem -subj "/CN=flux-e2e-test-ca"

# Server key + CSR for the registry, CN/SAN bound to the alias
openssl genrsa -out server-key.pem 4096
openssl req -new -key server-key.pem -out server.csr -subj "/CN=${ALIAS}"
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out server-cert.pem -days 3650 -sha256 \
  -extfile <(printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$ALIAS")

rm -f server.csr ca.srl ca-key.pem
echo "Regenerated CA + server cert (SAN DNS:${ALIAS})"
