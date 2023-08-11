#!/bin/bash
# Generate the private key
openssl genrsa -out ../certs/v1.key 2048
# Retrieve the public IP address from the custom endpoint and store it in a variable
IP=$(curl -s https://ipify.app.runonflux.io)
# Generate the certificate with the IP address in the SAN
openssl req -x509 -new -nodes -key ../certs/v1.key -days 3650 -out ../certs/v1.crt -subj "/CN=self.api.runonflux.io/O=RunOnFlux" -addext "subjectAltName = DNS:self.api.runonflux.io, IP:$IP" > /dev/null 2>&1
sleep 2
