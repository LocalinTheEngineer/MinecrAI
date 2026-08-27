#!/bin/bash
# Milestone 3 uctan uca test: sunucu -> kopru -> demo -> egitim -> degerlendirme
set -u
cd "$(dirname "$0")/.."
BOLUM=${BOLUM:-4}
ADIM=${ADIM:-60}
EBOLUM=${EBOLUM:-2}
rm -rf /tmp/mtest && mkdir -p /tmp/mtest

node test/demoserver.js > /tmp/mtest/server.log 2>&1 &
SRV=$!
sleep 6

MC_PORT=25605 MC_VERSION=1.20.2 MC_HOST=localhost BRIDGE_PORT=8770 MC_USERNAME=Ajan \
  node bot/bridge/server.js > /tmp/mtest/bridge.log 2>&1 &
BR=$!
sleep 16   # sahnenin ajanin etrafinda kurulmasini bekle

cd python
echo "### [1/3] DEMO TOPLAMA ###"
timeout 250 python3 collect_demos.py --bolum $BOLUM --maks-adim $ADIM \
  --url ws://localhost:8770 --cikti /tmp/mtest/demos.npz 2>&1 | grep -viE "Chunk|prismarine|^ *at " | tail -16

echo; echo "### [2/3] EGITIM ###"
timeout 150 python3 train_bc.py --veri /tmp/mtest/demos.npz \
  --model /tmp/mtest/bc.pt --grafik /tmp/mtest/egitim.png --epoch 60 2>&1 | tail -11

echo; echo "### [3/3] DEGERLENDIRME ###"
timeout 230 python3 eval_agent.py --bolum $EBOLUM --maks-adim $ADIM \
  --model /tmp/mtest/bc.pt --grafik /tmp/mtest/karsilastirma.png \
  --url ws://localhost:8770 2>&1 | grep -viE "Chunk|prismarine|^ *at " | tail -16

kill $BR $SRV 2>/dev/null
