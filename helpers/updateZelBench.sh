#!/bin/bash

#information
COIN_DAEMON='zelcashd'
BENCH_DAEMON='zelbenchd'
COIN_CLI='zelcash-cli'
COIN_PATH='/usr/local/bin'
#end of required details

#Closing zelcash daemon and purge zelbench
sudo $COIN_CLI stop > /dev/null 2>&1 && sleep 5
sudo systemctl stop zelcash > /dev/null 2>&1 && sleep 3
sudo killall $COIN_DAEMON > /dev/null 2>&1
sudo systemctl stop zelbench > /dev/null 2>&1 && sleep 3
sudo killall $BENCH_DAEMON > /dev/null 2>&1
sudo apt-get purge zelbench -y > /dev/null 2>&1 && sleep 1
sudo rm /etc/apt/sources.list.d/zelcash.list > /dev/null 2>&1 && sleep 1

#Install zelbench apt package
echo 'deb https://apt.zel.cash/ all main' | sudo tee /etc/apt/sources.list.d/zelcash.list
gpg --keyserver keyserver.ubuntu.com --recv 4B69CA27A986265D
gpg --export 4B69CA27A986265D | sudo apt-key add -
sudo apt-get update
sudo apt install zelbench -y 
sudo chmod 755 $COIN_PATH/zelbench* sleep 2
if ! gpg --list-keys Zel > /dev/null; then
gpg --keyserver na.pool.sks-keyservers.net --recv 4B69CA27A986265D
gpg --export 4B69CA27A986265D | sudo apt-key add -
sudo apt-get update
sudo apt install zelbench -y 
sudo chmod 755 $COIN_PATH/zelbench* sleep 2
if ! gpg --list-keys Zel > /dev/null; then
gpg --keyserver eu.pool.sks-keyservers.net --recv 4B69CA27A986265D
gpg --export 4B69CA27A986265D | sudo apt-key add -
sudo apt-get update
sudo apt install zelbench -y
sudo chmod 755 $COIN_PATH/zelbench* sleep 2
if ! gpg --list-keys Zel > /dev/null; then
gpg --keyserver pgpkeys.urown.net --recv 4B69CA27A986265D
gpg --export 4B69CA27A986265D | sudo apt-key add -
sudo apt-get update
sudo apt install zelbench -y
sudo chmod 755 $COIN_PATH/zelbench* sleep 2
if ! gpg --list-keys Zel > /dev/null; then
gpg --keyserver keys.gnupg.net --recv 4B69CA27A986265D
gpg --export 4B69CA27A986265D | sudo apt-key add -
sudo apt-get update
sudo apt install zelbench -y
sudo chmod 755 $COIN_PATH/zelbench* && sleep 2
fi
fi
fi
fi

$COIN_DAEMON
