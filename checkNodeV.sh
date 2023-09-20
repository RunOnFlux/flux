#!/bin/bash
current_node_ver="$(node -v)"
required_node_ver="v17.0.0"
 if [ "$(printf '%s\n' "$required_node_ver" "$current_node_ver" | sort -V | head -n1)" = "$required_node_ver" ]; then 
       echo "Using NodeJS ${current_node_ver}. Adjust ENV to allow for NodeJS ${required_node_ver} or greater."
 else
       echo "Using NodeJS ${current_node_ver}."
 fi