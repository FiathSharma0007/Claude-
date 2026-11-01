#!/usr/bin/env bash
# Builds ps5-games-on-pc.mp4: renders slides, then joins them with crossfades
# over a generated ambient music bed.
# Usage: ./build.sh [explainer.html] [output.mp4]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../../visuals/ps5-games-on-pc.html}"
out="${2:-$here/ps5-games-on-pc.mp4}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

node "$here/make-slides.js" "$src" "$work" >/dev/null

# Seconds on screen per slide (title, 5 diagrams, table, outro).
durs=(4 6 7 6 6 6 6 4)
xf=0.6   # crossfade length
fps=30

inputs=(); filter=""
for i in "${!durs[@]}"; do
  inputs+=(-loop 1 -framerate $fps -t "${durs[$i]}" -i "$work/slide-$(printf %02d "$i").png")
  filter+="[$i:v]format=yuv420p,setsar=1[v$i];"
done

# Chain xfades; each offset = running total minus crossfades so far.
prev="v0"; total=${durs[0]}
for ((i=1; i<${#durs[@]}; i++)); do
  offset=$(echo "$total - $xf" | bc)
  filter+="[$prev][v$i]xfade=transition=fade:duration=$xf:offset=$offset[x$i];"
  prev="x$i"; total=$(echo "$offset + ${durs[$i]}" | bc)
done
filter+="[$prev]fade=t=in:st=0:d=0.8,fade=t=out:st=$(echo "$total - 1" | bc):d=1[vout];"

# Ambient pad: A-minor-ish chord with a slow swell, softened and normalised.
n=${#durs[@]}
filter+="aevalsrc='0.12*(sin(2*PI*110*t)+0.6*sin(2*PI*164.81*t)+0.45*sin(2*PI*220*t)+0.25*sin(2*PI*261.63*t))*(0.7+0.3*sin(2*PI*0.125*t))':s=48000:d=$total,"
filter+="lowpass=f=1800,aecho=0.8:0.6:180:0.3,afade=t=in:d=1.5,afade=t=out:st=$(echo "$total - 2" | bc):d=2,loudnorm=I=-20:TP=-2:LRA=7,aresample=48000[aout]"

ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex "$filter" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -r $fps \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -t "$total" "$out"
echo "$out (${total}s)"
