#!/bin/bash
set -u
cd "$(dirname "$0")/.."
node test/testserver.js > /tmp/testserver.log 2>&1 &
SRV=$!
sleep 6
MC_PORT=25599 MC_VERSION=1.20.2 MC_HOST=localhost BRIDGE_PORT=8765 \
  node bot/bridge/server.js > /tmp/bridge.log 2>&1 &
BR=$!
sleep 10
cd python && timeout 120 python3 random_agent.py --adim 25 2>&1 | tail -35
KOD=$?
kill $BR $SRV 2>/dev/null
exit $KOD
