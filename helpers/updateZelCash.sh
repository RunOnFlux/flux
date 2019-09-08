#!/bin/bash

#wallet information
COIN_NAME='zelcash'
COIN_DAEMON='zelcashd'
COIN_CLI='zelcash-cli'
#end of required details

#Closing zelcash daemon
sudo $COIN_CLI stop > /dev/null 2>&1 && sleep 5
sudo systemctl stop zelcash > /dev/null 2>&1 && sleep 3
sudo killall $COIN_DAEMON > /dev/null 2>&1

#Updating zelcash package
sudo apt-get update -y
sudo apt-get install zelcash -y
sudo chmod 755 /usr/local/bin/zelcash*
sleep 2
zelcashd