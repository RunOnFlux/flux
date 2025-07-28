#!/bin/bash
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout ../certs/v1.key -out ../certs/v1.crt -subj '/CN=self.api.runonflux.io/O=RunOnFlux' > /dev/null 2>&1
sleep 2
