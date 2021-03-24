#!/bin/bash

#information
COIN_NAME='flux'
COIN_CLI='flux-cli'
COIN_DAEMON='fluxd'
BENCH_DAEMON='fluxbenchd'
BENCH_NAME='fluxbench'
COIN_PATH='/usr/local/bin'
#end of required details

# add to path
PATH=$PATH:"$COIN_PATH"
export PATH

if [[ -f "$COIN_PATH/zelcashd" ]]; then
  # Removing old version if exist
  sudo systemctl stop zelcash && sleep 3
  zelcash-cli stop >/dev/null 2>&1 && sleep 3
  sudo killall zelcashd >/dev/null 2>&1
  sudo killall -s SIGKILL "$BENCH_DAEMON" >/dev/null 2>&1 && sleep 1
  sudo apt-get purge zelbench -y >/dev/null 2>&1 && sleep 1
  sudo rm /etc/apt/sources.list.d/zelcash.list >/dev/null 2>&1 && sleep 1
fi

if [[ -f "$COIN_PATH/$COIN_DAEMON" ]]; then
  # Closing flux daemon and purge apt package
  sudo systemctl stop "$COIN_NAME" && sleep 3
  "$COIN_CLI" stop >/dev/null 2>&1 && sleep 3
  sudo killall "$COIN_DAEMON" >/dev/null 2>&1
  sudo killall -s SIGKILL "$BENCH_DAEMON" >/dev/null 2>&1 && sleep 1
  sudo apt-get purge "$BENCH_NAME" -y >/dev/null 2>&1 && sleep 1
fi

# cleaning
sudo rm /etc/apt/sources.list.d/flux.list >/dev/null 2>&1
sudo rm /usr/share/keyrings/flux-archive-keyring.gpg >/dev/null 2>&1

# creating apt list file
echo 'deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/flux-archive-keyring.gpg] https://apt.zel.network/ all main' | sudo tee /etc/apt/sources.list.d/flux.list >/dev/null 2>&1

# downloading key && save it as keyring
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/flux-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 4B69CA27A986265D >/dev/null 2>&1

# Checking keyring file
if ! gpg -k --keyring /usr/share/keyrings/flux-archive-keyring.gpg Zel >/dev/null 2>&1; then
  # First attempt to retrieve keys failed will try a different keyserver
  sudo rm /usr/share/keyrings/flux-archive-keyring.gpg >/dev/null 2>&1
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/flux-archive-keyring.gpg --keyserver hkp://na.pool.sks-keyservers.net:80 --recv-keys 4B69CA27A986265D >/dev/null 2>&1
fi

# Checking keyring file
if ! gpg -k --keyring /usr/share/keyrings/flux-archive-keyring.gpg Zel >/dev/null 2>&1; then
  # Last keyserver also failed will try one last keyserver
  sudo rm /usr/share/keyrings/flux-archive-keyring.gpg >/dev/null 2>&1
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/flux-archive-keyring.gpg --keyserver hkp://keys.gnupg.net:80 --recv-keys 4B69CA27A986265D >/dev/null 2>&1
fi

# update if keyring  is correct
if gpg -k --keyring /usr/share/keyrings/flux-archive-keyring.gpg Zel >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install "$BENCH_NAME" -y
  sudo chmod 755 "$COIN_PATH/$BENCH_NAME"* && sleep 2
fi

# starting flux daemon
if sudo systemctl list-units --full --no-legend --no-pager --plain --all --type service "$COIN_NAME.service" | grep -Foq "$COIN_NAME.service"; then
  sudo systemctl start "$COIN_NAME"
else
  "$COIN_DAEMON"
fi
