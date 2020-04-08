#!/bin/bash

#information
COIN_DAEMON='zelcashd'
COIN_CLI='zelcash-cli'
COIN_PATH='/usr/local/bin'
#end of required details

# add to path
PATH=$PATH:"$COIN_PATH"
export PATH

#Closing zelcash daemon
"$COIN_CLI" stop >/dev/null 2>&1 && sleep 5
sudo systemctl stop zelcash >/dev/null 2>&1 && sleep 3
sudo killall "$COIN_DAEMON" >/dev/null 2>&1
sudo killall -s SIGKILL zelbenchd >/dev/null 2>&1
sleep 2
"$COIN_DAEMON"
