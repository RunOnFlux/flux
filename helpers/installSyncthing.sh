#!/bin/bash

# Add the release PGP keys:
sudo curl -o /usr/share/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg

# Add the "stable" channel to your APT sources:
echo 'deb [signed-by=/usr/share/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable' | sudo tee /etc/apt/sources.list.d/syncthing.list

# update cert
sudo apt install ca-certificates -y > /dev/null 2>&1

# Update and install syncthing:
sudo apt-get update -y
sudo apt-get install syncthing -y
