#!/bin/sh
set -eu
if [ "$(/usr/bin/id -u)" -ne 0 ]; then echo "Run with sudo: $0" >&2; exit 1; fi
APP='/Library/Application Support/NSW Fire Coverage'
STATE='/Library/Application Support/NSW Fire Coverage Data'
/bin/launchctl print system/au.nswfirecoverage.standalone >/dev/null
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = '1' ]; then ARCH='arm64'; else ARCH='x64'; fi
NODE="$APP/runtime/darwin-$ARCH/node"
PORT=$("$NODE" -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port))' "$STATE/server.json")
BASE="http://localhost:$PORT"
/usr/bin/curl --noproxy '*' --fail --silent --show-error "$BASE/api/healthz"
echo
RESULT=$(/usr/bin/curl --noproxy '*' --fail --silent --show-error --max-time 60 "$BASE/api/fire-context?latitude=-33.8688&longitude=151.2093")
printf '%s' "$RESULT" | "$NODE" -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{const r=JSON.parse(s);if(r.kind!=="frnsw"){console.error("Sydney was not confirmed as FRNSW. Check outbound access to NSW services.");process.exit(1)}});'
echo "PASS: launchd service, native $ARCH runtime, local HTTP API and live Sydney FRNSW boundary check."
echo "Open $BASE/ to test addresses, maps and station links."
