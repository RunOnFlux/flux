#!/bin/sh
# Every 15 s, this node's syncthing's running totals of time spent in its database,
# its filesystem calls and its pulls (its /metrics), each line stamped with the UTC
# time it was read, into /var/log/flux-syncthing-metrics.log. A failed suite's dump
# carries the file, so a slow sync shows when its time went as well as where. A read
# the daemon does not answer writes nothing.
home="${SYNCTHING_PATH:-/dat/usr/lib/syncthing}"
out=/var/log/flux-syncthing-metrics.log
while true; do
  key=$(sed -n 's|.*<apikey>\(.*\)</apikey>.*|\1|p' "$home/config.xml" 2>/dev/null | head -1)
  if [ -n "$key" ]; then
    stamp=$(date -u +%H:%M:%S)
    curl -s -m 5 -H "X-API-Key: $key" http://127.0.0.1:8384/metrics 2>/dev/null \
      | grep -E '^syncthing_(db_operation_seconds_total|fs_operation_seconds_total|model_folder_pull_seconds_total)' \
      | sed "s/^/$stamp /" >> "$out"
  fi
  sleep 15
done
