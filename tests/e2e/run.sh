#!/usr/bin/env bash
# Browser workflows on an iPhone-sized page, plus a LibreOffice recalculation
# of every workbook they export. Not part of `npm test`: it needs Chromium with
# Playwright, Python with reportlab, Pillow and openpyxl, and LibreOffice
# (all present in the Claude Code cloud image); ffmpeg is optional.
#   tests/e2e/run.sh            # every workflow
#   tests/e2e/run.sh live-flow  # one
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p files shots
node dump-pages.mjs files/pages.json
python3 make_pdfs.py files >/dev/null
python3 make_tpl.py files/acme-template.xlsx >/dev/null
python3 make_model.py files/uw-model.xlsx >/dev/null
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('files/uw-model.xlsx') as z, zipfile.ZipFile('files/uw-model.xlsm', 'w', zipfile.ZIP_DEFLATED) as o:
    for i in z.infolist(): o.writestr(i, z.read(i.filename))
    o.writestr('xl/vbaProject.bin', bytes(range(64)))
open('files/legacy.xls', 'wb').write(b'\xd0\xcf\x11\xe0legacy')
PY
if command -v ffmpeg >/dev/null; then ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=440:duration=3" -c:a libvorbis files/memo.ogg; fi
: > files/empty.m4a
# the AI flow runs the real server code (server/), which needs its one package
[ -d ../../server/node_modules/@anthropic-ai/sdk ] || (cd ../../server && npm ci --silent)
(cd ../.. && python3 -m http.server 8080 --bind 127.0.0.1 >/dev/null 2>&1) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
FLOWS=${1:-"workflows rentroll-flow template-flow tools-flow ai-flow home-flow backup-flow a11y-flow live-flow voice-flow final-e2e deal-persistence deal-isolation comps-reload errors-flow pwa-flow tpl-flow comps-flow mobile-audit"}
for f in $FLOWS; do echo "===== $f"; node "$f.mjs"; done
for x in files/*.xlsx files/*.xlsm; do case "$x" in *acme-template.xlsx) continue;; esac; echo "===== recalc $x"; python3 -W ignore recalc.py "$x"; done
