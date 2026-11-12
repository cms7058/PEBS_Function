#!/bin/bash
set -e
cd "$(dirname "$0")/.."
if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
fi
[ -f data/pages.json ] || python3 scripts/index_handbook.py
[ -d node_modules ] || npm install
cargo build --manifest-path backend/Cargo.toml
server_dir=$(mktemp -d /tmp/xg-api.XXXXXX)
cp ./backend/target/debug/nist-model-api "$server_dir/nist-model-api"
"$server_dir/nist-model-api" &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true; rm -rf "$server_dir"' EXIT INT TERM
# Wait for the API before opening the frontend so project creation is available.
python3 - <<'PYTHON'
import os,time,urllib.request
address='http://127.0.0.1:'+os.environ.get('PORT','8787')+'/api/health'
for attempt in range(100):
    try:
        with urllib.request.urlopen(address,timeout=1) as response:
            if response.status==200:break
    except OSError:time.sleep(.2)
else:raise SystemExit('项目服务启动失败，请检查后端启动输出')
PYTHON
npm run dev -- "$@"
