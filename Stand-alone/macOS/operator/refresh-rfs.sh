#!/bin/sh
set -eu
if [ "$(/usr/bin/id -u)" -ne 0 ]; then echo "Run with sudo: $0" >&2; exit 1; fi
APP='/Library/Application Support/NSW Fire Coverage'
LABEL='au.nswfirecoverage.standalone'
PLIST="/Library/LaunchDaemons/$LABEL.plist"
RESTORE=0
restore() {
  if [ "$RESTORE" -eq 1 ]; then /bin/launchctl bootstrap system "$PLIST"; fi
}
trap restore EXIT
if /bin/launchctl print "system/$LABEL" >/dev/null 2>&1; then
  PID=$(/bin/launchctl print "system/$LABEL" | /usr/bin/awk '/pid = / {print $3;exit}')
  /bin/launchctl bootout "system/$LABEL"
  RESTORE=1
  COUNT=0
  while [ -n "$PID" ] && /bin/kill -0 "$PID" 2>/dev/null; do
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -ge 35 ]; then echo 'Previous service has not stopped. Refresh cancelled.' >&2; exit 1; fi
    /bin/sleep 1
  done
fi
/usr/bin/sudo -u _nswfirecoverage -- "$APP/bin/start-server.sh" --refresh-rfs
