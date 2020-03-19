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

#Make sure our key and apt is present
echo 'deb https://apt.zel.cash/ all main' | sudo tee /etc/apt/sources.list.d/zelcash.list
gpg --keyserver keyserver.ubuntu.com --recv 4B69CA27A986265D > /dev/null 2>&1
gpg --keyserver na.pool.sks-keyservers.net --recv 4B69CA27A986265D > /dev/null 2>&1
gpg --keyserver eu.pool.sks-keyservers.net --recv 4B69CA27A986265D > /dev/null 2>&1
gpg --export 4B69CA27A986265D | sudo apt-key add - > /dev/null 2>&1

#Updating zelcash package
sudo apt-get update -y
sudo apt-get install zelbench -y
sudo chmod 755 /usr/local/bin/zelbench*
sleep 2
zelcashd
