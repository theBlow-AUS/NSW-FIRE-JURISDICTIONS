# Stand-alone Windows installation

**Release 1.2.0** includes configurable RSS/Atom/GeoRSS map layers on the checker, in addition to local GIS projects and cached RFS feeds. Fire danger is on by default at 30% transparency; incidents are off. See [RSS-FEEDS.md](RSS-FEEDS.md) and [GIS-WORKSPACE.md](GIS-WORKSPACE.md).

**macOS:** For the Intel/Apple Silicon `.pkg` installer with default port **5400**, see [macOS/README.md](macOS/README.md). The Windows MSI below remains on its original default port.

Self-hosted **NSW Fire Coverage** for **Windows Server 2022 x64** and **Windows 10 x64**. Wired and Wi-Fi networks are both supported.

The MSI includes the website, its local API, Node.js x64 runtime, dated RFS reference data, and a Windows service wrapper. **It does not connect to Replit, require a Replit account, use a Replit database, or need Node/npm/pnpm installed on the target computer.**

This is **self-hosted, not internet-disconnected**. Official NSW public data services remain necessary. The standalone HTML download in `LOCAL HOST` remains a separate option; this MSI additionally runs the local API and scheduled updater.

## Install

1. Obtain `NSW-Fire-Coverage-1.2.0-x64.msi` and its SHA-256 file.
2. Check the hash in PowerShell:
   ```powershell
   Get-FileHash .\NSW-Fire-Coverage-1.2.0-x64.msi -Algorithm SHA256
   ```
3. Run the MSI with an administrator account, or use an elevated terminal:
   ```powershell
   msiexec.exe /i "NSW-Fire-Coverage-1.2.0-x64.msi" /l*v "$env:TEMP\NSWFireCoverage-install.log"
   ```
   For managed silent installation:
   ```powershell
   msiexec.exe /i "NSW-Fire-Coverage-1.2.0-x64.msi" /qn /norestart /l*v "$env:TEMP\NSWFireCoverage-install.log"
   ```
4. Open **http://localhost:8080/** or use the **NSW Fire Coverage** Start menu shortcut.

Requirements:

- Windows x64, administrator rights for installation, and a modern Edge/Chrome browser.
- Built-in .NET Framework **4.6.1 or newer** for WinSW. Server 2022 includes .NET Framework 4.8; very old Windows 10 images may need their organisation's approved Windows updates.
- TCP port **8080** available. Configuration can be changed after installation.
- Outbound HTTPS access to the official services listed below, from both the server and users' browsers.
- Enough disk space for the bundled runtime, application, cache, and rotating logs; allow at least 300 MB.

The MSI is **not code-signed**. Windows or your organisation's software policy may warn or block it. Have your administrator review and sign the installer with an approved certificate if required; do not bypass organisational policy.

## What is installed

| Item | Default location / behaviour |
| --- | --- |
| Application and bundled Node | `C:\Program Files\NSW Fire Coverage\` |
| Windows service | `NSWFireCoverage`, display name `NSW Fire Coverage` |
| Service startup | Automatic; restarts after an unexpected process failure |
| Service account | `NT AUTHORITY\LocalService`, not an administrator |
| Configuration | `C:\ProgramData\NSW Fire Coverage\server.json` |
| Persistent RFS cache | `C:\ProgramData\NSW Fire Coverage\data\rfs-cache.json` |
| Rotating service/application logs | `C:\ProgramData\NSW Fire Coverage\logs\` |
| Initial listen address | `0.0.0.0:8080` |

The installer grants LocalService modify access only to the application data directory, not Program Files. There is no external database or session-secret requirement. Configuration is created on first start and is **not overwritten by an upgrade**. Data and logs are retained on uninstall for backup/recovery.

## Access from another computer

Open `http://<server-name-or-LAN-IP>:8080/`. The server and clients must be able to reach one another; wired and Wi-Fi connections are interchangeable. Guest-Wi-Fi isolation, VLAN rules, endpoint security, and centrally managed firewall policy can still block access.

No inbound firewall exception is added automatically. For approved LAN access, run this supplied script in an elevated PowerShell window:

```powershell
& 'C:\Program Files\NSW Fire Coverage\operator\Allow-LanAccess.ps1'
```

It permits only the configured TCP port, from the **local subnet**, on **Domain/Private** profiles. It does not open Public-network access or router port forwarding. If script execution is restricted, have your administrator review the script and apply the equivalent firewall rule through approved management tools.

This is a read-only reference tool with **no login**. Keep it on a trusted network. For HTTPS, put an organisation-managed IIS/reverse proxy in front of `http://127.0.0.1:8080`, serve it at the site's root, and set `host` to `127.0.0.1`. Do not expose the service directly to the public internet. Browser geolocation may require HTTPS when accessed from another computer; address search and pin selection do not require browser geolocation.

## Configuration

Edit `C:\ProgramData\NSW Fire Coverage\server.json` as an administrator:

```json
{
  "host": "0.0.0.0",
  "port": 8080,
  "dataDirectory": "./data",
  "updaterEnabled": true
}
```

`dataDirectory` is relative to the configuration file unless absolute. Supported bind addresses are `0.0.0.0`, `127.0.0.1`, `::1`, and `::`. If moving data to another directory, grant the LocalService account modify access there. Avoid network-share storage; this installation maintains one local cache writer.

After editing:

```powershell
Restart-Service NSWFireCoverage
Get-Service NSWFireCoverage
```

If changing the port, update the firewall rule and browser URL too. The installed Start menu shortcut uses the default port 8080.

## Services and data sources

There are **no Replit runtime requests**, development plugins, telemetry clients, remote font requests, package downloads, or external database connections in the installed payload. Scripts, styles, icons, and system fonts are served locally. A Content Security Policy restricts application data connections to the local server and official NSW spatial-service hosts.

| Source | Purpose | Caller |
| --- | --- | --- |
| `https://mapsq.six.nsw.gov.au/services/public/Address_Location` | GURAS-backed house-number/street address lookup | Browser |
| `https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Guras/MapServer/2/query` | GURAS address-point lookup | Browser |
| `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer` | NSW locality and LGA checks | Browser/server |
| `https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer/1` | FRNSW Fire District polygon intersections | Server/browser fallback |
| `https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer/0` | Nearby FRNSW station names, addresses, and locations | Browser |
| `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer` | Map tiles and attribution | Browser |
| `https://www.rfs.nsw.gov.au/fire-information/BFDP` | Scheduled RFS fire-permit requirement table refresh | Server |
| `https://www.rfs.nsw.gov.au/about-us/fire-control-centres` | Source of bundled, separately dated RFS contact reference | Reference link |
| `https://www.fire.nsw.gov.au/contact/fire-station` and station profiles | Official station details and phone numbers | User-opened links |
| `https://www.fire.nsw.gov.au/page.php?id=200` | Official FRNSW permit information | User-opened link |

Addresses, pin coordinates, and map requests necessarily reach the relevant public data services. An administrator can verify outbound requests through browser developer tools and server/network logs. NSW agencies can change endpoints, data, rate limits, terms, or access controls.

## RFS updater and data safety

The local service checks whether a run is due every minute. Refresh slots are the union of:

- **Mondays at 3 am Australia/Sydney**
- **First calendar day of each month at 3 am Australia/Sydney**
- **Last calendar day of each month at 3 am Australia/Sydney**

Coinciding dates run once. A service that was stopped catches up on the latest missed slot when next started. The attempted slot is saved before the network call so a blocked source is not scraped repeatedly. The contact directory is a separately dated reference, not an automatically refreshed contact scraper.

If the RFS source returns HTTP 403, times out, or changes format, the last successful dated data is retained and the warning remains visible. A first installation starts from the source-controlled dated reference snapshot; it does not claim that a live refresh succeeded. Cache writes use a same-directory temporary file and atomic replacement. Invalid saved cache files are preserved as `.invalid-*` files rather than silently deleted.

To request a manual retry while preventing two cache writers:

```powershell
& 'C:\Program Files\NSW Fire Coverage\operator\Refresh-Rfs.ps1'
```

This briefly stops the service, performs the refresh, and restores its previous running state. Respect the source's access controls; it does not bypass an HTTP 403 block.

## Verify and troubleshoot

```powershell
& 'C:\Program Files\NSW Fire Coverage\operator\Check-Installation.ps1'
```

This checks the service, local site, health endpoint, and a Sydney FRNSW point. Also open the site, search a house-number address, move the pin, and inspect nearby station links. NSW service availability and browser network policy affect these live checks.

Useful commands:

```powershell
Get-Service NSWFireCoverage
Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
Invoke-RestMethod http://localhost:8080/api/healthz
Get-ChildItem 'C:\ProgramData\NSW Fire Coverage\logs'
```

If installation rolls back, review the verbose MSI log. A service-start failure commonly means an occupied port, blocked executable, invalid configuration, missing .NET Framework, or data-folder permissions. Do not grant broad write access to Program Files to work around a permissions issue.

## Upgrade and uninstall

Build a higher three-part MSI version for each release. Installation stops and replaces the service binaries, then starts the service again. Back up ProgramData before an upgrade.

Uninstall using Windows Apps/Programs or the matching MSI:

```powershell
msiexec.exe /x "NSW-Fire-Coverage-1.2.0-x64.msi" /qn /norestart
```

The service and installed binaries are removed. ProgramData is deliberately retained. If retiring the server, back it up and remove it manually after uninstall. If you enabled the optional firewall rule, remove it:

```powershell
Get-NetFirewallRule -Name NSWFireCoverage-LAN -ErrorAction SilentlyContinue | Remove-NetFirewallRule
```

## Build from the Git source

The build files live in this `Stand-alone` folder. The web UI, shared fire-data logic, API response schemas, validated permit scraper, and dated reference data are reused from the existing repository; the hosted application's database/service entry points are **not** included.

Build on Linux/WSL using Node.js 22+, pnpm, Python 3, and `wixl` from **msitools 0.106+**:

```sh
pnpm install --frozen-lockfile
node Stand-alone/scripts/build.mjs
node --test Stand-alone/tests/*.test.mjs
```

The build:

1. Downloads the official Windows Node runtime and WinSW wrapper, verifying SHA-256 pins in `dependencies.lock.json`.
2. Builds production web assets with **no Replit Vite plugins** and removes external font requests.
3. Bundles the local server and cache without database/native-module dependencies.
4. Includes upstream licence notices and a per-file SHA-256 manifest.
5. Compiles an x64, per-machine MSI with service installation, automatic startup, uninstall handling, prerequisite checks, and restricted data-folder permissions.

Outputs:

- `Stand-alone/dist/NSW-Fire-Coverage-1.2.0-x64.msi` and matching `.sha256`
- `generated-artifacts/standalone/` containing the staging payload and generated `product.wxs`

Source, configuration templates, and build scripts are tracked in Git. Large generated installers, downloaded runtimes, and staged payloads are excluded from Git/deployment output. Attach the MSI and checksum to a GitHub Release if your organisation distributes builds that way.

To change the release version:

```sh
INSTALLER_VERSION=1.0.1 node Stand-alone/scripts/build.mjs
```

`--skip-msi` builds the payload and WiX definition without invoking wixl. Updating runtime dependencies requires reviewing new upstream versions and deliberately updating their source URLs and SHA-256 pins.

## Verification limits

The repository tests exercise the bundled server, API contracts, configuration persistence, scheduled-refresh deduplication, corrupt/failed cache handling, and absence of Replit/font runtime URLs. The MSI database can be inspected with `msiinfo` and its payload extracted with `msiextract`.

The installer is compiled in a Linux build environment. **A native Windows installation/upgrade/uninstall test is still required before rolling it out broadly**, including any organisation-specific endpoint-protection or software-signing policies. `operator/Check-Installation.ps1` is provided for that check.

## Accuracy and emergency use

FRNSW polygon coverage takes priority over RFS LGA-based data. Within an FRNSW Fire District, fire permits are required year-round. Outside those polygons, Rural Fire District coverage is inferred only after NSW confirmation, not established by a separate RFD boundary layer. RFS Yes/No source wording is not an independent BFDP declaration, permission to burn, or a Total Fire Ban check.

Nearby stations are ranked by direct distance, not dispatch responsibility or road distance. Phone numbers open on official station profiles; station-specific emails are not published.

All results remain indicative and can be affected by boundary changes or unavailable/outdated sources. **In an emergency, call 000.**
