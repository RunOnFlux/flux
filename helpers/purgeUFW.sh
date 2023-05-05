#!/bin/bash

# load all deny rules for app ports into an array
readarray -t deny_array < <(sudo ufw status numbered | grep 'DENY' | grep -E '(3[0-9]{4})')

# get the array length
len=${#deny_array[@]}

# loop through the array and delete the ufw deny rules - starting at the end of the list
for ((i=${#deny_array[@]}-1; i>=0; i--)); do
  rule_number=$(echo "${deny_array[$i]}" | awk -F'[][]' '{print $2}' | tr -d ' ')
  echo 'y' | sudo ufw delete "${rule_number}" > /dev/null 2>&1
  unset deny_array[$i]
done
