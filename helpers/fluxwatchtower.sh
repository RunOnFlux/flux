#!/bin/bash

echo "Checking if flux_watchtower is installed..."
apps_check=$(docker ps | grep "flux_watchtower")

if [[ "$apps_check" == "" ]]; then

  echo "Stopping flux_watchtower..."
  docker stop flux_watchtower > /dev/null 2>&1
  sleep 2
  echo "Removing flux_watchtower..."
  docker rm flux_watchtower > /dev/null 2>&1
  echo "Downloading containrrr/watchtower image..."
  docker pull containrrr/watchtower:latest > /dev/null 2>&1
  echo "Starting containrrr/watchtower..."
  random=$(shuf -i 7500-35000 -n 1)
  echo "Interval: $random sec."
  apps_id=$(docker run -d \
  --restart unless-stopped \
  --name flux_watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --cleanup --interval $random 2> /dev/null)

  if [[ $apps_id =~ ^[[:alnum:]]+$ ]]; then
    echo "flux_watchtower installed successful, id: $apps_id"
  else
    echo "flux_watchtower installion failed..."
  fi

else
  echo "flux_watchtower already installed!..."
fi
