#!/bin/bash

#information
COIN_NAME='flux'
COIN_DAEMON='fluxd'
COIN_CLI='flux-cli'
COIN_PATH='/usr/local/bin'
#end of required details

# add to path
PATH=$PATH:"$COIN_PATH"
export PATH

#Closing zelcash daemon
sudo systemctl stop "$COIN_NAME" >/dev/null 2>&1 && sleep 3
"$COIN_CLI" stop >/dev/null 2>&1 && sleep 3
sudo killall "$COIN_DAEMON" >/dev/null 2>&1
sudo killall -s SIGKILL fluxbenchd >/dev/null 2>&1
sleep 2

if sudo systemctl list-units --full --no-legend --no-pager --plain --all --type service "$COIN_NAME.service" | grep -Foq "$COIN_NAME.service"; then
  sudo systemctl start "$COIN_NAME"
else
  "$COIN_DAEMON"
fi
