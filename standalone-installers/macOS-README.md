# NSW Fire Coverage — macOS installer

**Release 1.1.0** adds local GIS projects, FileGDB/KML/KMZ imports, working-copy edits, validated GeoJSON exports and five cached live RFS feeds. See [the GIS workspace guide](GIS-WORKSPACE.md) in this repository; it is also installed as `GIS-WORKSPACE.md` beside this guide.

One self-hosted `.pkg` for **Intel x86-64 and Apple Silicon**, with native runtimes for both. **Default port: 5400.** No Rosetta, separate Node installation, Replit account, Replit database, or Replit runtime connection is required.

This is a local server with live official NSW data calls, **not an internet-disconnected installation**. Address lookup, boundaries, maps and station locations still require the official NSW services. Browsers contact spatial services directly; the local server performs boundary/LGA checks and scheduled RFS permit-table refreshes.

## Compatibility

- **Technical compatibility floor: macOS 11 Big Sur**, Intel or Apple Silicon.
- The bundled Node.js 22 binaries declare a macOS 11 minimum. Both executables are included unchanged and the launcher chooses the native architecture automatically.
- macOS 10.15 Catalina and earlier are not included: reaching them would require older, end-of-life runtime choices or an unsupported custom runtime.
- This compatibility floor is **not a security-support promise**. Older macOS releases, including Big Sur, no longer receive normal Apple security support. Use a still-patched macOS release for production whenever possible.
- A modern browser, administrator rights for installation, and approximately 1 GB free disk space are recommended.
- The package is **unsigned and not notarized**. Organisation-managed Macs may reject it. Have your administrator review, sign and notarize it using approved Apple credentials before wider deployment. Do not disable Gatekeeper or organisational controls.

## Install and open

1. Download `NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg` and its checksum.
2. Verify the SHA-256:
   ```sh
   shasum -a 256 NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg
   ```
3. Open the package in Installer and follow your organisation's approval process. Administrator installation is required.
4. Open **http://localhost:5400/** or the **NSW Fire Coverage** web link installed in Applications.

For an approved command-line installation:

```sh
sudo /usr/sbin/installer -pkg "/path/to/NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg" -target /
```

The installer does not download anything on the target Mac. It installs on the current system volume, starts the local service, and checks its HTTP health endpoint. Neither Python nor a package manager is required on the target.

## Installed locations

| Item | Location |
| --- | --- |
| Read-only application and bundled runtimes | `/Library/Application Support/NSW Fire Coverage/` |
| launchd definition | `/Library/LaunchDaemons/au.nswfirecoverage.standalone.plist` |
| Configuration | `/Library/Application Support/NSW Fire Coverage Data/server.json` |
| Persistent RFS cache | `/Library/Application Support/NSW Fire Coverage Data/data/rfs-cache.json` |
| Logs | `/Library/Application Support/NSW Fire Coverage Data/logs/` |
| Browser link | `/Applications/NSW Fire Coverage.webloc` |
| launchd service label | `au.nswfirecoverage.standalone` |
| Restricted service user/group | `_nswfirecoverage` |

The service starts at boot, before anyone signs in. It does not run as root. The hidden service account has no usable login password, a false login shell and no administrator membership. The application and daemon definition are root-owned; the service can write only its data and pre-created log files. Installer scripts reject conflicting pre-existing accounts/groups rather than replacing them.

Configuration, cache and logs are separate from the installed program and retained on upgrade or uninstall. Upgrades stop the previous service before replacing binaries; existing administrator configuration is not overwritten.

## Configuration and LAN access

The initial configuration is:

```json
{
  "host": "0.0.0.0",
  "port": 5400,
  "dataDirectory": "./data",
  "updaterEnabled": true
}
```

Use `sudoedit "/Library/Application Support/NSW Fire Coverage Data/server.json"` to change it. `dataDirectory` is relative to that configuration file unless absolute. Moving it requires appropriate permissions for `_nswfirecoverage`.

Restart after a change:

```sh
sudo launchctl kickstart -k system/au.nswfirecoverage.standalone
```

For another device on the LAN, use `http://<Mac-name-or-LAN-IP>:5400/`. Wired and wireless connections are both suitable. The Mac and each client still need access to the public NSW endpoints.

No blanket inbound firewall exception is created. If macOS or endpoint security blocks incoming connections, ask your administrator to approve the bundled Node executable for the native architecture and TCP 5400 on the intended trusted network. Guest-network isolation and VLAN rules can also block access.

The service has **no login** and is intended for trusted networks. Do not expose it directly to the public internet. For HTTPS, use an organisation-managed reverse proxy and change `host` to `127.0.0.1`. Browser geolocation may need HTTPS outside localhost; address search and dropped pins do not require browser geolocation.

If you change the port, update bookmarks, the installed `.webloc` URL and any firewall/proxy rules. The default remains 5400 for new macOS installations. This package does not change an existing Windows installation's port.

## RFS updater and stored data

The background process uses the same dated reference data and interpretation rules as the Windows standalone installation. No external database is used.

Refresh slots are **Monday at 3 am Australia/Sydney**, plus **the first and last calendar day of each month at 3 am**. Coinciding dates run once. After downtime, the service catches up on the latest due slot. The attempted slot is persisted so a blocked source is not requested every minute.

A failed or HTTP 403-blocked refresh retains the last successful dated permit table and displays a warning. First installation begins with the dated bundled snapshot, not a claimed live success. The Fire Control Centre directory is a separately dated reference snapshot. Cache updates use same-directory temporary files and atomic replacement; damaged saved files are preserved for administrator review.

Manual refresh, with the service stopped to avoid concurrent cache writers:

```sh
sudo "/Library/Application Support/NSW Fire Coverage/operator/refresh-rfs.sh"
```

The script restores the previous running state after the attempt. It does not bypass source access controls.

## Verify and troubleshoot

```sh
sudo "/Library/Application Support/NSW Fire Coverage/operator/check-installation.sh"
```

This checks the launchd job, selected native runtime, health endpoint, and a live Sydney FRNSW point. Then open the site and check an address, map pin and station links.

Other useful commands:

```sh
sudo launchctl print system/au.nswfirecoverage.standalone
curl --noproxy '*' http://localhost:5400/api/healthz
sudo tail -n 80 "/Library/Application Support/NSW Fire Coverage Data/logs/service-error.log"
sudo tail -n 80 "/Library/Application Support/NSW Fire Coverage Data/logs/service.log"
sudo lsof -nP -iTCP:5400 -sTCP:LISTEN
```

Startup failure commonly means the port is occupied, configuration is invalid, execution is blocked by policy, or the data directory has incorrect permissions. The installer also writes its normal progress/errors to macOS installation logs. The logs are local files; an administrator should include them in normal log-retention management. Do not grant the service write access to its program or launchd directories.

## Data services and accuracy

Runtime data connections are limited to the local site/API and:

- `mapsq.six.nsw.gov.au`: GURAS-backed street-address lookup.
- `maps.six.nsw.gov.au`: GURAS address points, NSW localities/LGAs and NSW Base Map tiles.
- `portal.data.nsw.gov.au`: official FRNSW Fire District polygons and station locations.
- `www.rfs.nsw.gov.au/fire-information/BFDP`: server-side RFS permit-table refresh.

Official RFS contact sources and FRNSW permit/station pages are linked for users to open. Station phone numbers remain on those official profiles; station-specific emails are not published. Scripts, styles, icons and system fonts are local. The production build excludes Replit development plugins, telemetry clients and remote-font requests, and the browser Content Security Policy excludes Replit.

FRNSW polygons override RFS LGA data. FRNSW fire districts require fire permits year-round. Rural Fire District coverage is inferred after NSW confirmation, not established by a separate RFD boundary. RFS Yes/No wording is not independent BFDP confirmation, permission to burn, or a Total Fire Ban check. Nearby stations are ranked by direct distance, not dispatch responsibility.

Results are indicative and can be affected by boundary/data changes and unavailable public services. **In an emergency, call 000.**

## Uninstall

```sh
sudo "/Library/Application Support/NSW Fire Coverage/operator/uninstall.sh"
```

This stops and removes the launchd service, installed application, Applications web link, and package receipt. **Configuration, cache, logs and the disabled-login service account remain**, preserving ownership for recovery or reinstallation. Ask your administrator to back up and remove retained data/account records separately if retiring the installation.

## Build from Git

Source lives under `Stand-alone/macOS`; application/server logic is shared with the existing standalone build rather than a separate fork.

On the Linux build machine, install Node.js 22+, pnpm, Python 3, a C++11-capable `g++`, GNU cpio, xar and bomutils (for `lsbom` inspection):

```sh
pnpm install --frozen-lockfile
node Stand-alone/macOS/scripts/build.mjs
python3 Stand-alone/macOS/tests/package_test.py
```

The builder downloads the two official Node archives and validates the SHA-256 pins in `dependencies.lock.json`. It also compiles a pinned upstream BOM writer as a build-only tool: the legacy distro writer aborts under current fortified Linux libraries. No compiler protections are disabled. These tool sources and the compiler are not installed on the target Mac.

The builder verifies Mach-O CPU identities and declared minimum macOS versions, builds local production web/server assets without Replit plugins, and creates a standard flat distribution package containing a root-owned cpio payload, BOM receipt inventory, package scripts, OS/architecture metadata and installer resources.

Outputs:

- `Stand-alone/dist/NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg`
- Matching `.sha256` file.
- Staging tree and packaging metadata in `generated-artifacts/standalone-macos/`.

Generated runtimes, packages and staging files are excluded from Git. To bump a release, set `INSTALLER_VERSION=1.0.1` when building. The Windows build remains separate, including its original port configuration.

For native Apple-tool repackaging, transfer the prepared staging tree/metadata and repository to a Mac and run:

```sh
sh Stand-alone/macOS/scripts/build-native.sh
```

That uses Apple's `pkgbuild` and `productbuild`. Before managed distribution, use your approved **Developer ID Installer** identity with `productsign`, submit the signed package through `notarytool` using an existing approved keychain profile, then staple the notarization ticket. Signing credentials do not belong in this repository.

## Verification limits

Cross-build tests inspect package structure, payload hashes, BOM entries, executable modes, native runtime architectures/minimum OS, launchd metadata, installer-script syntax and configuration defaults. The shared web/API is also browser-tested against the production payload, and the Windows regression suite remains applicable to the shared local server/cache.

**This Linux build cannot run macOS Installer or launchd. Native installation, startup, upgrade and uninstall still need pilot testing on both an Intel Mac and an Apple Silicon Mac before a broad rollout.** Compilation and archive inspection are not a claim that those native tests have passed.
