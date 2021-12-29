#!/bin/bash

arch=$(dpkg --print-architecture)

if [[ "$arch" = *amd* ]]; then

  #echo -e "Checking if fluxwatchtower is installed...."
  apps_check=$(docker ps | grep "fluxwatchtower")

  if [[ "$apps_check" == "" ]]; then
    #echo -e "${ARROW} ${CYAN}Downloading containrrr/watchtower image...${NC}"
    docker pull containrrr/watchtower:amd64-latest > /dev/null 2>&1
    #echo -e "${ARROW} ${CYAN}Starting containrrr/watchtower...${NC}"
    random=$(shuf -i 7500-35000 -n 1)
    #echo -e "${ARROW} ${CYAN}Interval: ${GREEN} $random sec.${NC}"
    apps_id=$(docker run -d \
    --name fluxwatchtower \
    -v /var/run/docker.sock:/var/run/docker.sock \
    containrrr/watchtower \
    --label-enable --cleanup --interval $random 2> /dev/null)

      if [[ $apps_id =~ ^[[:alnum:]]+$ ]]; then
        echo -e "FluxWatchtower installed successful, id: ${GREEN}$apps_id${NC}"
      else
        echo -e "FluxWatchtower installion failed...${NC}"
      fi
   fi

 else
 
  #echo -e "Checking if fluxwatchtower is installed...."
  apps_check=$(docker ps | grep "fluxwatchtower")

  if [[ "$apps_check" == "" ]]; then
    #echo -e "${ARROW} ${CYAN}Downloading containrrr/watchtower image...${NC}"
    docker pull containrrr/watchtower:arm64v8-latest > /dev/null 2>&1
    #echo -e "${ARROW} ${CYAN}Starting containrrr/watchtower...${NC}"
    random=$(shuf -i 7500-35000 -n 1)
    #echo -e "${ARROW} ${CYAN}Interval: ${GREEN} $random sec.${NC}"
    apps_id=$(docker run -d \
    --name fluxwatchtower \
    -v /var/run/docker.sock:/var/run/docker.sock \
    containrrr/watchtower \
    --label-enable --cleanup --interval $random 2> /dev/null)

      if [[ $apps_id =~ ^[[:alnum:]]+$ ]]; then
        echo -e "FluxWatchtower installed successful, id: ${GREEN}$apps_id${NC}"
      else
        echo -e "FluxWatchtower installion failed...${NC}"
      fi
   fi
   
 fi

cd zelflux && npm start
