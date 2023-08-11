#!/bin/bash
openssl genrsa -out ../certs/v1privkey.pem 2048
openssl req -new -key ../certs/v1privkey.pem -out ../certs/v1csr.pem -subj '/CN=self.api.runonflux.io/O=RunOnFlux'
openssl x509 -req -in ../certs/v1csr.pem -CA ../certs/v1rootcert.cert.pem -CAkey ../certs/v1rootcert.privkey.pem -CAcreateserial -out ../certs/v1cert.pem -days 3650
sleep 2
