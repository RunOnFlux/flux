#!/bin/bash

#information
COIN_DAEMON='zelcashd'
BENCH_DAEMON='zelbenchd'
COIN_CLI='zelcash-cli'
#end of required details

#Closing zelcash daemon
sudo $COIN_CLI stop > /dev/null 2>&1 && sleep 5
sudo systemctl stop zelcash > /dev/null 2>&1 && sleep 3
sudo killall $COIN_DAEMON > /dev/null 2>&1
sudo systemctl stop zelbench > /dev/null 2>&1 && sleep 3
sudo killall $BENCH_DAEMON > /dev/null 2>&1
sleep 2
zelcashd
