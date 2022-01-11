#!/bin/bash

echo "Checking if fluxwatchtower is installed..."
apps_check=$(docker ps | grep "fluxwatchtower")

if [[ "$apps_check" == "" ]]; then

  echo "Stopping fluxwatchtower..."
  docker stop fluxwatchtower > /dev/null 2>&1
  sleep 2
  echo "Removing fluxwatchtower..."
  docker rm fluxwatchtower > /dev/null 2>&1
  echo "Downloading containrrr/watchtower image..."
  docker pull containrrr/watchtower:latest > /dev/null 2>&1
  echo "Starting containrrr/watchtower..."
  random=$(shuf -i 7500-35000 -n 1)
  echo "Interval: $random sec."
  apps_id=$(docker run -d \
  --name fluxwatchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --cleanup --interval $random 2> /dev/null)

  if [[ $apps_id =~ ^[[:alnum:]]+$ ]]; then
    echo "FluxWatchtower installed successful, id: $apps_id"
  else
    echo "FluxWatchtower installion failed..."
  fi

else
  echo "Fluxwatchtower already installed!..."
fi
