#!/bin/bash

USER=fluxtesting
HASH_LOCATION=tests/images/.package_hash

if ! docker ps >/dev/null 2>&1; then
  echo "Docker not available at ${DOCKER_HOST:-/var/run/docker.sock}... exiting"
  exit 1
fi

npm config set update-notifier false

# The working dir will have files if flux repo has been mounted, if not
# assume that it needs to be cloned
if ! [ -n "$(ls -A . 2>/dev/null)" ]
then
  git clone https://github.com/RunOnFlux/flux.git .
fi

test -e $HASH_LOCATION || echo 0 > $HASH_LOCATION

# echo 0 should be redundant here
EXISTING_HASH=$(cat $HASH_LOCATION 2>/dev/null || echo 0)

# save as array, as referencing CURRENT_HASH will give first item
CURRENT_HASH=($(sha256sum package.json))

if [[ $EXISTING_HASH != $CURRENT_HASH ]]; then
  # only echo hash on success
  npm install && echo "$CURRENT_HASH" > $HASH_LOCATION
fi

npm run prebuild || exit 1

# create directories etc
sudo syncthing --home=/home/$USER/.config/syncthing 2>&1 > /dev/null &

npm run ciconfig

export NODE_CONFIG_DIR=$(pwd)/tests/unit/globalconfig
export FLUX_DATABASE=mongo

echo "NODE CONFIG DIR: $NODE_CONFIG_DIR"
echo "FLUX DATABASE: $FLUX_DATABASE"

# $@ is tests/unit/**/*.test.js by default (from dockerfile). Quoted, so mocha
# expands it rather than the shell - /bin/sh has no globstar and would read
# ** as *, which matches only the nested files.
echo "DOCKER CMD: $@"

touch {debug,info,warn,error}.log

if [[ -n $MANUAL_TEST ]]; then
  "$@"
  exit
fi

npx mocha "$@" --exit
status=$?
rm -f {debug,info,warn,error}.log
exit $status
