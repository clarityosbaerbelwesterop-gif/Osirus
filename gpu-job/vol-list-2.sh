#!/usr/bin/env bash
# FETCH vol-list-2: Volume 3qlkuqnr1u lesend listen und gezielt holen.
# Laeuft auf der BOX (nicht im Repo-CI). Auf /vol wird nichts geschrieben,
# geloescht oder ueberschrieben; lokal wird nichts Vorhandenes ueberschrieben.
#
#   1. Endpunkt holen:   gh run download <RUN> -n endpoint-age   (legt endpoint.age ab)
#   2. Listen:           ./vol-list-2.sh list
#   3. Gezielt holen:    ./vol-list-2.sh get quasnir/run2/logs quasnir/run2/train.jsonl ...
#   4. Fertig:           echo vol-list-2 > gpu-job/DONE, committen, pushen (Pod wird geloescht)
#
# Umgebung (Vorgaben anpassbar):
#   KEY   privater Schluessel zur Zeile 2 von gpu-job/FETCH
#   LOCAL lokaler Bestand vom 17.10. (Champion step-007500 liegt dort)
#   OUT   Zielordner fuer Listen und Geholtes
set -euo pipefail
KEY=${KEY:-$HOME/.ssh/box-s2-run2-fetch}
LOCAL=${LOCAL:-/workspace/gpu-runs/s2-run2-b200/fetch-vol}
OUT=${OUT:-/workspace/gpu-runs/vol-list-2}
CHAMPION_SHA=4b916d0923174997ffc48e92d2c990a36836361ed6ce51a67b1c10d4cfb9e2a7
RESERVE_GB=10   # so viel bleibt auf der Box mindestens frei

mkdir -p "$OUT"
[ -f endpoint.age ] || { echo "endpoint.age fehlt (gh run download <RUN> -n endpoint-age)"; exit 1; }
EP=$(age -d -i "$KEY" endpoint.age)
[[ "$EP" =~ ^[0-9.]+:[0-9]+$ ]] || { echo "Endpunkt unlesbar"; exit 1; }
SSH=(ssh -i "$KEY" -p "${EP#*:}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "root@${EP%:*}")

case "${1:-}" in
list)
  "${SSH[@]}" 'df -h /vol' | tee "$OUT/df.txt"
  "${SSH[@]}" 'cd /vol && du -h --max-depth=3 . 2>/dev/null | sort -h' > "$OUT/du.txt"
  "${SSH[@]}" 'cd /vol && find . -type f -newermt 2026-10-17 -printf "%TY-%Tm-%Td %TH:%TM %12s %p\n" | sort' > "$OUT/neu-seit-1017.txt"
  "${SSH[@]}" 'cd /vol && find quasnir/run2 -maxdepth 4 -printf "%y %12s %TY-%Tm-%Td %p\n" 2>/dev/null | sort -k4' > "$OUT/run2-baum.txt"
  # Champion auf dem Volume gegen den lokalen Stand pruefen (nur lesen).
  "${SSH[@]}" 'find /vol -path "*step-007500*" -name model.safetensors -exec sha256sum {} \;' > "$OUT/champion-sha.txt"
  echo "Champion erwartet: $CHAMPION_SHA"; cat "$OUT/champion-sha.txt"
  # Was lokal schon da ist (Dateinamen relativ zum Bestand vom 17.10.).
  (cd "$LOCAL" && find . -type f -printf "%12s %p\n" | sort -k2) > "$OUT/lokal.txt"
  echo "Listen in $OUT: df.txt du.txt neu-seit-1017.txt run2-baum.txt champion-sha.txt lokal.txt"
  ;;
get)
  shift
  [ "$#" -gt 0 ] || { echo "Pfade relativ zu /vol angeben"; exit 1; }
  for p in "$@"; do
    [[ "$p" =~ ^[A-Za-z0-9._/-]+$ && "$p" != *..* ]] || { echo "ungueltiger Pfad: $p"; exit 1; }
    # Keine Sammel-Zwischenstaende, den Champion nie neu holen.
    if [[ "$p" =~ step-00[2-7][0-9]{3} ]]; then echo "uebersprungen (Zwischenstand/Champion): $p"; continue; fi
    need=$("${SSH[@]}" "du -sk /vol/$p" | cut -f1)
    free=$(df -k --output=avail "$OUT" | tail -1)
    if [ $((need + RESERVE_GB * 1024 * 1024)) -gt "$free" ]; then
      echo "zu gross: $p ($((need / 1024)) MB, frei $((free / 1024)) MB)"; continue
    fi
    # tar liest auf dem Pod nur; lokal werden vorhandene Dateien nie ueberschrieben.
    "${SSH[@]}" "tar -C /vol -cf - $p" | tar -C "$OUT" -xf - --skip-old-files
    echo "geholt: $p ($((need / 1024)) MB) -> $OUT/$p"
  done
  ;;
*)
  echo "Aufruf: $0 list | get <pfad relativ zu /vol>..."; exit 1 ;;
esac
