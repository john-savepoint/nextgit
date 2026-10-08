#!/usr/bin/env bash
# chrome-slot.sh — concurrency-limited Chrome launcher.
#
# Why (John, 2026-10-08): at 30 concurrent workflows, UI suites each spawn headless
# Chrome; unbounded, that is ~30 Chrome instances (~100-300 MB each) and an OOM on a
# box this size. This wrapper serializes Chrome launches through N flock slots
# (default 4), then execs the real browser — flock's fd is inherited through exec, so
# a slot is held for exactly the Chrome process's lifetime.
#
# Wiring: the fleet exports CHROME_BIN=<this script> into every lane's env; suites and
# probes already prefer CHROME_BIN when resolving the binary.
#
# Env: CHROME_SLOTS (default 4), CHROME_BIN_REAL (default auto-detect), CHROME_SLOT_DIR
#      (default /tmp/nextgit-chrome-slots), CHROME_SLOT_WAIT (seconds, default 600).

set -u
SLOTS="${CHROME_SLOTS:-4}"
SLOT_DIR="${CHROME_SLOT_DIR:-/tmp/nextgit-chrome-slots}"
WAIT="${CHROME_SLOT_WAIT:-600}"
mkdir -p "$SLOT_DIR"

if [ -z "${CHROME_BIN_REAL:-}" ]; then
  for c in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1; then CHROME_BIN_REAL="$(command -v "$c")"; break; fi
  done
fi
if [ -z "${CHROME_BIN_REAL:-}" ]; then
  echo "chrome-slot: no real Chrome binary found" >&2
  exit 127
fi

deadline=$(( $(date +%s) + WAIT ))
while :; do
  for i in $(seq 1 "$SLOTS"); do
    lock="$SLOT_DIR/slot-$i.lock"
    # -n: don't block; try the next slot. FD stays open across exec → slot lifetime = chrome lifetime.
    if exec 9>"$lock" && flock -n 9; then
      exec "$CHROME_BIN_REAL" "$@"
    fi
  done
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "chrome-slot: timed out waiting for a free slot ($SLOTS slots) after ${WAIT}s" >&2
    exit 75
  fi
  sleep 2
done
