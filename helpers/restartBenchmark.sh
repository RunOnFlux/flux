#!/bin/bash

#information
SERVICE_NAME='zelcash'
BENCH_NAME='fluxbench'
BENCH_DAEMON='fluxbenchd'
BENCH_CLI='fluxbench-cli'
COIN_DAEMON='fluxd'
COIN_PATH='/usr/local/bin'
#end of required details

# add to path
PATH=$PATH:"$COIN_PATH"
export PATH

#Closing zelbench daemon
sudo systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 && sleep 3
"$BENCH_CLI" stop >/dev/null 2>&1 && sleep 3
sudo killall "$COIN_DAEMON" >/dev/null 2>&1
sudo killall -s SIGKILL "$BENCH_DAEMON" >/dev/null 2>&1
sudo killall -s SIGKILL zelbenchd >/dev/null 2>&1
sleep 2

if sudo systemctl list-units --full --no-legend --no-pager --plain --all --type service "$SERVICE_NAME.service" | grep -Foq "$SERVICE_NAME.service"; then
  sudo systemctl start "$SERVICE_NAME"
else
  "$COIN_DAEMON"
fi

