#!/bin/bash

USER=fluxtesting

# this saves having to use add_group on docker run or compose (group-add)
# sudo chown $USER:$USER /var/run/docker.sock

if ! docker ps 2>&1 >/dev/null
then
  echo "Docker not available... exiting"
  exit
fi

# The working dir will have files if flux repo has been mounted, if not
# assume that it needs to be cloned
if ! [ -n "$(ls -A . 2>/dev/null)" ]
then
  git clone https://github.com/RunOnFlux/flux.git .
fi

npm install

# create directories etc
sudo syncthing --home=/home/$USER/.config/syncthing 2>&1 > /dev/null &

npm config set update-notifier false

npm run ciconfig

export NODE_CONFIG_DIR=$(pwd)/tests/unit/globalconfig
export FLUX_DATABASE=mongo

echo "NODE CONFIG DIR: $NODE_CONFIG_DIR"
echo "FLUX DATABASE: $FLUX_DATABASE"

# $@ is tests/unit/*.test.js by default (from dockerfile)
echo "DOCKER CMD: $@"

touch {debug,info,warn,error}.log

npx mocha "$@" --exit; rm -f {debug,info,warn,error}.log
