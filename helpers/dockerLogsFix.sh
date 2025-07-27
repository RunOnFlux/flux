#!/bin/bash

if [[ -f "/etc/logrotate.d/docker_debug_log" ]]; then
   sudo rm -rf /etc/logrotate.d/docker_debug_log
   sudo systemctl restart docker
   echo "Docker log fixed, docker restarted..."
fi