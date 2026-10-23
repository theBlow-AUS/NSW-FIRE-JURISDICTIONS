#!/bin/sh
set -eu
if [ "$(/usr/bin/id -u)" -ne 0 ]; then echo "Run with sudo: $0" >&2; exit 1; fi
LABEL='au.nswfirecoverage.standalone'
APP='/Library/Application Support/NSW Fire Coverage'
PLIST="/Library/LaunchDaemons/$LABEL.plist"
if /bin/launchctl print "system/$LABEL" >/dev/null 2>&1; then
  /bin/launchctl bootout "system/$LABEL"
fi
/bin/rm -f "$PLIST" '/Applications/NSW Fire Coverage.webloc'
if [ -L "$APP" ]; then echo 'Refusing to remove a linked application directory.' >&2; exit 1; fi
/bin/rm -rf "$APP"
/usr/sbin/pkgutil --forget au.nswfirecoverage.standalone.macos
echo 'Service and installed program files removed.'
echo 'Configuration, RFS cache and logs remain in /Library/Application Support/NSW Fire Coverage Data.'
echo 'The disabled-login _nswfirecoverage account is retained to preserve ownership of that data.'
