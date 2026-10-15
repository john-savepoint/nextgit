#!/usr/bin/env bash
# tools/qa.sh — the computed QA battery for the promo master (run on the render).
# Usage: bash tools/qa.sh [path-to-mp4]   (default renders/video.mp4)
# Exit 0 = PASS/WARN summary; exit 2 = a FAIL was measured.
set -u
OUT="${1:-renders/video.mp4}"
FAILS=0

say() { printf '%s\n' "$*"; }
fail() { FAILS=$((FAILS+1)); say "FAIL  $*"; }

say "== file =="
ls -la "$OUT" || { say "missing: $OUT"; exit 2; }

say ""
say "== probe (codec/size/fps/duration) =="
ffprobe -v error \
  -show_entries format=duration,size,format_name \
  -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of default=noprint_wrappers=1 "$OUT"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
say "duration: ${DUR}s"

say ""
say "== G1: full decode to null (zero error lines expected) =="
ERRS=$(ffmpeg -v error -i "$OUT" -f null - 2>&1 | wc -l)
if [ "$ERRS" -eq 0 ]; then say "PASS  decode clean (0 error lines)"; else fail "decode produced $ERRS error lines (see below)"; ffmpeg -v error -i "$OUT" -f null - 2>&1 | head -10; fi

say ""
say "== G6: loudness (ebur128, expect I ≈ -14 ±1 LUFS, TP ≤ -1 dBTP) =="
ffmpeg -hide_banner -i "$OUT" -af ebur128 -f null - 2>&1 | awk '
  /I: *-/ { i=$0 } /Peak:/ { p=$0 } /LRA:/ { l=$0 }
  /Summary/ { s=1 }
  END { print i; print p; print l }' | sed 's/^ *//'

say ""
say "== G8: black frames (blackdetect d=0.4, pix_th=0.08) =="
BLACK=$(ffmpeg -hide_banner -i "$OUT" -vf "blackdetect=d=0.4:pix_th=0.08" -an -f null - 2>&1 | awk '/black_start/ {print}')
if [ -z "$BLACK" ]; then say "PASS  no black stretches ≥0.4 s"; else say "WARN  black stretches:"; say "$BLACK"; fi

say ""
say "== G8b: silence (silencedetect n=-50dB d=2.5) =="
SIL=$(ffmpeg -hide_banner -i "$OUT" -af "silencedetect=n=-50dB:d=2.5" -f null - 2>&1 | awk '/silence_start/ {print}')
if [ -z "$SIL" ]; then say "PASS  no silence stretches ≥2.5 s"; else say "WARN  silence stretches:"; say "$SIL"; fi

say ""
if [ "$FAILS" -eq 0 ]; then say "QA: PASS (no hard failures; WARNs above are advisory)"; exit 0; else say "QA: FAIL ($FAILS hard failures)"; exit 2; fi
