# NSW Fire District Checker

A map-based checker for looking up a NSW property address or dropping a pin and seeing whether the location intersects a mapped Fire and Rescue NSW (FRNSW) fire district. If a point is confirmed to be in NSW and no FRNSW district polygon is returned, the app labels the result **Rural Fire District**. This is an indicative inference, not a check against an authoritative RFD boundary.

The standalone edition also provides a **local GIS workspace** for importing vector layers, editing working copies, exporting validated GeoJSON, and viewing cached official RFS incident, advisory, fire-danger and Total Fire Ban feeds.

> **Safety:** This is an indicative reference and GIS tool, not emergency dispatch, legal permission to burn, or an official Rural Fire District boundary determination. **In an emergency, call 000.**
>
> **Release status:** Supplied installers are labelled **1.1.0**, are unsigned, and the Mac package is not notarized. Native installation, upgrade, reboot and uninstall pilots remain pending on Windows Server 2022, Windows 10 x64, Intel Mac and Apple Silicon Mac. Linux package inspection is not native installation evidence. See the [pilot coverage and administrator runbook](Stand-alone/tests/NATIVE-UPGRADE-PILOT.md).

## Contents

- [Choose an edition](#choose-an-edition)
- [Features](#features)
- [Supported GIS layers and formats](#supported-gis-layers-and-formats)
- [GIS editing, exports and capacity](#gis-editing-exports-and-capacity)
- [How coverage results work](#how-coverage-results-work)
- [Data sources and services](#data-sources-and-services)
- [Run the web app](#run-the-web-app)
- [Use the local HTML version](#use-the-local-html-version)
- [Standalone installation](#standalone-installation)
- [Configuration and network access](#configuration-and-network-access)
- [Data storage, backup, upgrades and removal](#data-storage-backup-upgrades-and-removal)
- [Troubleshooting](#troubleshooting)
- [Build and verification](#build-and-verification)
- [Repository layout](#repository-layout)
- [Attribution and limitations](#attribution-and-limitations)

## Choose an edition

| Edition | Address/map/coverage checker | RFS permit information | Local GIS and five live feeds | Installation |
| --- | --- | --- | --- | --- |
| Hosted web app | Yes; live NSW services | Hosted API cache and scheduled updater | Not enabled | Modern browser; hosted API uses PostgreSQL |
| Double-click `LOCAL HOST` HTML | Yes; internet still required for lookups/tiles | Embedded dated snapshot; no background refresh | No | Open `LOCAL HOST/index.html`; no server or Node required |
| Windows standalone | Yes | Local disk cache and scheduled updater | Yes | x64 MSI; bundled runtime; default port **8080** |
| macOS standalone | Yes | Local disk cache and scheduled updater | Yes | Intel/Apple Silicon PKG; bundled native runtimes; default port **5400** |
| Linux manual standalone | Shared server can run with a Linux Node runtime | Local disk cache and scheduled updater | Shared source implementation | Source build/manual launch; **no Linux installer or managed service supplied** |

Standalone means the server, data storage and GIS conversions run on your own machine. Windows/Mac installations do not require a Replit account, Replit runtime service, separately installed Node/GDAL, or external database. **It does not mean fully offline:** address search, boundary checks, base maps and fresh public feeds still depend on official NSW internet services.

## Features

- **RSS map layers (website and standalone 1.2.0):** add public HTTPS RSS/Atom/GeoRSS feeds, toggle each overlay and adjust transparency. RFS incidents start off; RFS fire danger starts on at 30% transparency. Settings persist in this browser. See [RSS sources, geometry provenance and limits](Stand-alone/RSS-FEEDS.md).

- Search for a house-number street address with a suburb or postcode using NSW GURAS-backed addressing.
- Show the matched address on a map so the user can confirm the location.
- Drop or move a pin on the map to check a location independently of its nearest address.
- Show the coverage result both beside the pin and below the map.
- Reverse-check a dropped pin for its NSW locality and, when nearby, a GURAS property address point.
- Enter decimal latitude and longitude directly, with range validation.
- Resolve the selected point to its NSW Local Government Area (LGA).
- Outside FRNSW districts, show the dated RFS **Fire Permit required: Yes/No** table entry and published Fire Control Centre district, telephone and physical address.
- Show snapshot dates, unmatched records, overdue data and blocked/failed refresh warnings. A missing record is **Unavailable**, never an assumed No.
- Provide source links and explain when an address match was adjusted or a nearby point is being shown.
- Include a single-file local HTML build in the `LOCAL HOST` folder. It opens by double-clicking, with no local installation or server, but still needs internet access for live services.
- Show nearby FRNSW stations ranked by direct distance, with links to official station profiles for contact details. Proximity is not dispatch responsibility or road distance.

### Standalone GIS and live-feed features

- Create, rename and remove local projects; project removal moves files to `gis-trash`.
- Import multiple vector layers and keep original uploaded files with SHA-256 source manifests.
- Keep **Sources**, **Working** copies and **Exports** separate. Edits do not overwrite the uploaded source dataset.
- Change layer names, visibility, colour and opacity; edit feature attributes and GeoJSON geometry.
- View local geometry, other visible project layers and incident overlays without requiring base-map tiles for the local vector drawing.
- Save validated WGS84 GeoJSON exports and a separate provenance manifest.
- Optionally enrich exports with regional fire-danger/ban information using an explicitly selected council-name field. Exact normalized names are matched; unknown and ambiguous names are reported rather than guessed.
- Cache each official feed independently, preserve last-good data on failure, and show source dates, freshness and errors.
- Export incident GeoJSON, advisory/region JSON or CSV, and feed provenance.

## Supported GIS layers and formats

These are the formats exposed by the standalone workspace, **not every driver supported by upstream GDAL**.

| Input | Support | Important limits |
| --- | --- | --- |
| Esri File Geodatabase **`.gdb` directory** | Vector feature classes, including layers within feature datasets | Select the **whole directory**, not one internal `.gdbtable` file. Layers are presented individually; geodatabase hierarchy/rules are not recreated. |
| **`.gdb.zip`** | ZIP containing a complete `.gdb` directory | Use this naming convention; arbitrary ZIP bundles are not a general-purpose import format. Conversion depends on engine capacity. |
| **KML / KMZ** | Local vector features converted through the bundled portable engine | External network links/XML entities are not supported. Exact styling, embedded icons and tours are not reproduced. |
| **GeoJSON / `.json` containing GeoJSON** | Feature data; WGS84 working copies | Generic JSON tables are not GIS layers. Legacy CRS declarations require actual coordinate transformation, not simply removing the CRS field. |
| ArcMap **`.lyr`** | Original reference file retained with a warning | **Not rendered or converted into feature data.** Supply its linked `.gdb`, KML or GeoJSON. Exact Esri symbology is not reproduced. |
| Shapefile, GeoPackage, personal/enterprise geodatabase, `.lyrx`, CAD and raster files | Not exposed as supported workspace imports | Convert supported vector data to GeoJSON/KML or a supported FileGDB first. Do not infer support from the engine's driver list. |
| Remote WMS/WFS/WMTS, arbitrary ArcGIS URLs and tile layers | No general-purpose “add service” interface | The checker has its own fixed official map/boundary services and the five configured RFS feeds below. |

Working geometry supports `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon` and `GeometryCollection`. Records with null geometry can still appear in attribute views. WGS84 coordinates are **[longitude, latitude]**; the address checker's separate input fields are labelled latitude and longitude.

FileGDB attachments, relationships, domains, topology rules and exact ArcGIS project/layer styling do not round-trip into GeoJSON. Exports are **GeoJSON plus provenance**, not edited FileGDB, KML/KMZ or `.lyr` files.

## GIS editing, exports and capacity

Open **Local GIS & live feeds**, or browse to `/workspace` on the standalone server:

1. Create a project.
2. Choose supported files or a complete `.gdb` directory.
3. Select a layer and review import warnings, coordinate information and retained sources.
4. Inspect features, edit the working copy, then save.
5. Export saved data and download its separate provenance. For council enrichment, select a field you have confirmed contains council names.

### Current-source large-layer behaviour

The current source uses a disk-backed SQLite/RTree working index, bounded map previews, paginated attributes and sparse transactional edits. Revision checks reject stale saves. The full saved working layer—not the current map extent, attribute page or search result—is used for export.

**Source and packaged release are not interchangeable:** a checked-in installer may have been built before later source improvements. Consult its included `GIS-WORKSPACE.md` and `BUILD-MANIFEST.json`; rebuild and test a new release to distribute newer behaviour. In particular, do not assume a previously downloaded 1.1.0 installer includes every indexing/large-layer change described in current source documentation.

| Current-source limit | Value / meaning |
| --- | --- |
| Uploaded bytes | **8 GiB** default; configurable up to **32 GiB**. This is an upload ceiling, not a promise that an equally large FileGDB can be converted. |
| Map preview per layer | Up to **1,000 features / 2 MiB**; complex geometries can be omitted with a warning. |
| Other visible layer overlays | At most **8**, each bounded separately. |
| Attribute page | **100** records by default, **200** maximum; normally 2 MiB, with a single larger record allowed so paging advances. |
| Individual feature | **8 MiB**; field metadata is limited to 2,000 names / 1 MiB. |
| Save | Up to **100 changed records / 16 MiB** per request; save regularly. |
| Export validation | Batches of up to **10,000 features / 8 MiB**, each in a fresh engine process. A conversion has a 15-minute timeout; a full multi-batch export can take longer. |

Exports check coordinate ranges, geometry structure, closed rings and per-geometry validity using GDAL/GEOS. Invalid geometry blocks export rather than being silently repaired. This does **not** prove cross-feature or geodatabase topology rules. Feature counts are checked before publishing the export.

The portable WebAssembly conversion engine has its own memory/address-space limits, independent of Node's heap and free disk space. Geometry complexity matters. Large-layer speed/capacity has not been established on all native Windows/Mac targets; Linux benchmark results are not native performance guarantees. See [GIS workspace details](Stand-alone/GIS-WORKSPACE.md) and [large-layer limits and benchmarks](Stand-alone/GIS-LARGE-LAYERS.md).

## How coverage results work

The app sends the selected address or pin coordinates to the FRNSW district polygon layer and asks whether the point intersects a district feature:

1. A matching feature is reported as **Within an FRNSW fire district**, with the district name when available.
2. No matching feature is reported as **Rural Fire District** only when the location is confirmed as being in NSW. This is inferred from the absence of an FRNSW polygon hit; the app does not verify a separate RFD boundary.
3. If the point cannot be confirmed as being in NSW, or a service request fails, the app does not infer a rural result.

**FRNSW boundaries take priority over all LGA-based RFS information.** A positive FRNSW polygon hit suppresses RFS permit-table answers and RFS contact matches for that result. If the FRNSW boundary check fails, RFS information is withheld rather than used as a fallback classification.

If a point is inside an FRNSW Fire District, a fire permit is required year-round. See the official [FRNSW fire permits information](https://www.fire.nsw.gov.au/page.php?id=200).

The result is indicative only. Boundary data can change, mapped address points may not coincide with dwellings, and the checker does not confirm emergency response arrangements. In an emergency, call 000.

## Data sources and services

The application uses official public NSW services, not an independently maintained geocoder or boundary dataset. The browser performs address/map lookups; the local/hosted API coordinates point coverage/LGA and cached RFS responses. Requests still depend on the upstream services.

| Purpose | Source |
| --- | --- |
| Address search | NSW Address Location Service, backed by the NSW Geocoded Urban and Rural Address System (GURAS): [`Address_Location`](https://mapsq.six.nsw.gov.au/services/public/Address_Location). [NSW dataset information](https://www.data.nsw.gov.au/data/dataset/address-location-service). |
| Nearby address point for a dropped pin | NSW Spatial Services GURAS ArcGIS layer 2: [`Guras/MapServer/2`](https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Guras/MapServer/2). |
| Locality, postcode, and state at a dropped pin | NSW Administrative Boundaries ArcGIS layer 0: [`NSW_Administrative_Boundaries/MapServer/0`](https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer/0). |
| FRNSW district coverage | NSW ArcGIS Feature Service `FRNSW_Locations`, layer 1: [`FRNSW_Locations/FeatureServer/1`](https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer/1). Layer 0 is the associated stations layer; the coverage check uses layer 1. |
| Nearby FRNSW stations | [`FRNSW_Locations/FeatureServer/0`](https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer/0). Public location points, not district coverage; phone details are on linked official station profiles. |
| FRNSW permit requirement | The official [FRNSW Fire Permits page](https://www.fire.nsw.gov.au/page.php?id=200) states that permits are required all year in FRNSW Fire Districts. |
| Map background | NSW Spatial Services cached NSW Base Map tiles: [`NSW_Base_Map/MapServer`](https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer). Copyright © NSW Department of Customer Service 2020. |
| Point-to-LGA lookup | NSW Spatial Services Administrative Boundaries, layer 1: [`LocalGovernmentArea`](https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer/1), queried with `esriSpatialRelIntersects` and EPSG:4326 coordinates. |
| RFS permit requirement | The **Council name / Fire Permit required** HTML table on the official [Bush Fire Danger Period and Fire Permits page](https://www.rfs.nsw.gov.au/fire-information/BFDP). |
| RFS district and Fire Control Centre contacts | A dated snapshot of the official [Fire Control Centres directory](https://www.rfs.nsw.gov.au/about-us/fire-control-centres), matched by published LGA name, not proximity. |

The search requests EPSG:4326 coordinates. Pin reverse lookups use the GURAS point service and NSW locality boundaries. If a nearby GURAS address point is displayed, the coverage check still uses the exact dropped-pin coordinates.

### RFS interpretation and refreshes

The RFS table reports **whether a fire permit is required**, not a field explicitly labelled “BFDP Active/Inactive”. The checker preserves the source wording and does not claim an independently verified legal BFDP declaration. A No answer is not permission to burn. Total Fire Bans, Fire Danger Ratings, council restrictions and other rules are separate; the **permit-table determination** does not use `fdrToban.xml`. The standalone GIS feed viewer uses that separate feed for regional danger/ban advisories, not as a permit determination.

The hosted API persists the last successful permit table in PostgreSQL. Its updater attempts one scrape:

- every **Monday at 3 am Australia/Sydney**;
- on the **first calendar day** of each month at 3 am;
- on the **last calendar day** of each month at 3 am.

Coinciding dates run once. Sydney daylight saving, month lengths and leap years are accounted for. A database advisory lock and persisted run date prevent duplicate scrapes across replicas/restarts. On startup, a missed scheduled slot is caught up once; requests from users only read the cache and never scrape the RFS page.

At implementation time, direct automated requests to RFS received a **Cloudflare HTTP 403 challenge**. The app therefore includes a dated snapshot obtained from the official pages through a page reader. Failed scheduled fetches retain that snapshot and expose the error and attempt time in the UI; blocked access is not bypassed. An unexpected, incomplete or unrecognisable table is rejected rather than overwriting good data.

The FCC directory is a separately dated reference snapshot, not a weekly live scrape. Some directory names are historical or have no current LGA match. Unmatched contacts remain unavailable; the checker does not guess. The snapshot importer keeps multiple published contacts where an LGA entry lists them.

The timer runs only while the API process is running. For unattended production operation, use an always-running API host, or invoke `NODE_ENV=production node artifacts/api-server/dist/rfs/refresh-cli.mjs` from an external scheduler regularly; it checks the Sydney schedule before scraping. An autoscaling process that sleeps cannot guarantee an exact 3 am run. This repository does not publish or provision an external scheduled deployment automatically.

Read-only endpoints:

- `GET /api/fire-context?latitude=-33.8688&longitude=151.2093`
- `GET /api/rfs/status`
- `GET /api/rfs/snapshot` — dated cached data and refresh metadata, without scraping.

### Standalone live RFS feeds

| Feed | Official URL | Default polling |
| --- | --- | --- |
| Incidents, primary GeoJSON | https://www.rfs.nsw.gov.au/feeds/majorIncidents.json | 15 minutes |
| Incidents, supplementary GeoRSS | https://www.rfs.nsw.gov.au/feeds/majorIncidents.xml | 15 minutes |
| Regional danger ratings / Total Fire Bans | https://www.rfs.nsw.gov.au/feeds/fdrToban.xml | 60 minutes |
| Regional danger / ban RSS fallback | https://www.rfs.nsw.gov.au/feeds/fdrTobanRSS.xml | 60 minutes |
| Major Fire Updates | https://www.rfs.nsw.gov.au/feeds/major-Fire-Updates.xml | 15 minutes |

Incidents are deduplicated by stable source ID/GUID, preferring primary GeoJSON. Local cached feeds remain readable during outages and are marked stale; an old snapshot is not a live emergency feed. Major-fire advisories without geometry are not assigned invented locations. Regional ratings do not create region polygons or change the checker’s permit rules.

The local server polls feeds independently of browser visits. Manual feed refresh has a minimum one-minute cooldown. The permit scraper's Monday/month-start/month-end schedule remains separate.

### About the supplied GURAS CSV export

The statewide CSV ZIP supplied during development contains address and relationship attributes for AddressPoint, AddressString, WayPoint, ProWay, and PropertyLot. It does not contain point coordinates or geometry in those files. The CSVs are therefore not used as an offline geocoding index in this app. The address search and reverse lookup use the live NSW services listed above.

## Run the web app

This is a React and Vite app in the `artifacts/nsw-fire-district-checker` package of a pnpm workspace. From the repository root:

```sh
pnpm install
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/nsw-fire-district-checker run dev
```

Then open `http://localhost:4173`. `PORT` and `BASE_PATH` are required by the Vite configuration. To check types:

```sh
pnpm --filter @workspace/nsw-fire-district-checker run typecheck
```

The hosted RFS feature also needs the existing API service and PostgreSQL database. Apply the development schema with `pnpm --filter @workspace/db run push`, then run the API through its configured workflow (or `PORT=8080 pnpm --filter @workspace/api-server run dev`). In the workspace, use the shared preview proxy so `/api` routes reach the API service.

To check a scheduled slot manually, use `pnpm --filter @workspace/api-server run refresh:rfs`. Append `--force` only for an intentional extra attempt. There is no public refresh endpoint. Tests are available via `pnpm --filter @workspace/api-server run test:rfs`.

## Use the local HTML version

Extract the downloadable ZIP and open `LOCAL HOST/index.html` in a modern browser. It is a self-contained HTML file and does not require Node.js or a local web server. An internet connection is still required for address lookups, LGA/fire-district checks, and map tiles. RFS permit/contact information is an embedded dated snapshot, including refresh warnings at export time. **The file cannot update while closed, and it does not run background jobs.** Network policy or browser restrictions may prevent access to the public services.

To rebuild the download with the latest hosted cache, keep the API running and use:

```sh
PORT=4173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/nsw-fire-district-checker run build
node artifacts/nsw-fire-district-checker/scripts/package-local-html.mjs
```

The packager reads `/api/rfs/snapshot` through the workspace proxy without initiating a scrape. Alternatively, supply a previously saved snapshot JSON file as its first argument. It writes `artifacts/nsw-fire-district-checker/LOCAL HOST/` and `generated-artifacts/NSW-Fire-District-Checker-LOCAL-HOST.zip`; generated downloads are excluded from Git.

## Standalone installation

### Downloads and platform status

| Platform | Package | Local address | Status |
| --- | --- | --- | --- |
| Windows Server 2022 / Windows 10 **x64** | [MSI](standalone-installers/NSW-Fire-Coverage-1.1.0-x64.msi) · [SHA-256](standalone-installers/NSW-Fire-Coverage-1.1.0-x64.msi.sha256) | `http://localhost:8080/` | Cross-built/inspected; native pilot pending. Windows ARM/32-bit packages are not supplied. |
| macOS **Intel + Apple Silicon** | [PKG](standalone-installers/NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg) · [SHA-256](standalone-installers/NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg.sha256) | `http://localhost:5400/` | Both native runtimes included; native pilots pending. |
| Linux | No `.deb`, `.rpm`, AppImage or bundled Linux runtime | Manual example below uses `http://localhost:8080/` | Shared server runs on Linux; no distro-wide installation/service support claim. |

On GitHub, open the package link and choose **Download raw file**. Obtain the matching checksum separately and compare it before installation. If a checkout contains a small Git LFS pointer instead of a binary, it is not an installer; obtain the actual release file. A matching checksum verifies bytes, not publisher identity or an OS code-signing signature.

Choose a currently patched OS under your organisation's support policy. Naming Windows 10 or macOS Big Sur as a compatibility target does not mean the OS still receives general vendor security updates.

### Windows Server 2022 / Windows 10 x64

**Requirements:** administrator rights, modern Edge/Chrome, available TCP **8080**, built-in .NET Framework **4.6.1+** for WinSW, outbound HTTPS to the official data services, and space for datasets/working copies/exports as well as the program. Allow at least 300 MB for the initial application, and substantially more for GIS data and conversion scratch files. Server 2022 includes a suitable .NET Framework; older images may need approved updates.

1. Download the MSI and `.sha256`.
2. In PowerShell, compare the hash against the checksum file:

   ```powershell
   Get-FileHash .\NSW-Fire-Coverage-1.1.0-x64.msi -Algorithm SHA256
   Get-Content .\NSW-Fire-Coverage-1.1.0-x64.msi.sha256
   ```

3. Run the MSI as administrator, or from an elevated terminal:

   ```powershell
   msiexec.exe /i "NSW-Fire-Coverage-1.1.0-x64.msi" /l*v "$env:TEMP\NSWFireCoverage-install.log"
   ```

   For an approved silent installation:

   ```powershell
   msiexec.exe /i "NSW-Fire-Coverage-1.1.0-x64.msi" /qn /norestart /l*v "$env:TEMP\NSWFireCoverage-install.log"
   ```

4. Open **http://localhost:8080/** or the Start menu shortcut. The GIS workspace is **http://localhost:8080/workspace**.
5. Check the service and health:

   ```powershell
   Get-Service NSWFireCoverage
   Invoke-RestMethod http://localhost:8080/api/healthz
   & 'C:\Program Files\NSW Fire Coverage\operator\Check-Installation.ps1'
   ```

The installer registers an automatic **NSWFireCoverage** service running as **LocalService**, with recovery configuration. Node is bundled; do not install Node/npm/GDAL on the destination PC just to use the MSI. The unsigned MSI may be blocked by organisational policy; use approved review/signing processes rather than bypassing controls.

Full guide: [Windows installation and administration](Stand-alone/README.md).

### macOS — Intel and Apple Silicon

**Requirements:** administrator rights, modern browser, available TCP **5400**, outbound HTTPS and sufficient dataset/scratch disk space. Approximately 1 GB free for initial installation is recommended before accounting for GIS projects. The bundled runtime declares **macOS 11** as its technical minimum; use a currently security-supported macOS release. Catalina and earlier are not targeted.

1. Download the universal-distribution PKG and `.sha256`.
2. Verify it from the download directory:

   ```sh
   shasum -a 256 -c NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg.sha256
   ```

3. Open it in Installer, or use an approved administrator terminal:

   ```sh
   sudo /usr/sbin/installer \
     -pkg "/path/to/NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg" \
     -target /
   ```

4. Open **http://localhost:5400/** or the web link in Applications. GIS: **http://localhost:5400/workspace**.
5. Verify the local service:

   ```sh
   curl --noproxy '*' http://localhost:5400/api/healthz
   sudo "/Library/Application Support/NSW Fire Coverage/operator/check-installation.sh"
   ```

The package includes separate native Intel and arm64 runtimes; its launcher selects the correct one without requiring Rosetta. It registers the **au.nswfirecoverage.standalone** launchd service, intended to start at boot under the restricted **_nswfirecoverage** account. No destination Python, Node or package manager is needed.

The package is **unsigned and not notarized**. Have an administrator review/sign/notarize it as required. Do not disable Gatekeeper globally.

Full guide: [macOS installation and administration](Stand-alone/macOS/README.md).

### Linux — manual shared-server setup

**The MSI and PKG do not install on Linux.** There is no Linux installer or service unit in this repository. The runtime-independent shared payload can be built and launched with Linux Node; local server/fixture tests have run on Linux x64. That does not establish support for every distribution, CPU, service manager or production workload.

For a technically managed Linux machine:

1. Install a maintained Node.js **22** runtime with `node:sqlite` support (the packages pin **22.23.4**) and pnpm. Build dependencies must be available; no `wixl` or Apple packaging tools are needed for `--shared-only`.
2. From the repository root, build the shared payload:

   ```sh
   pnpm install --frozen-lockfile
   node Stand-alone/scripts/build.mjs --shared-only
   ```

   This writes `generated-artifacts/standalone-macos/shared/payload/`. Despite the staging directory's name, its shared `app/` is runtime-independent JavaScript plus the portable GIS engine. It does **not** include a Linux Node binary or register a system service.

3. Create a configuration and persistent state directory, outside the generated build output:

   ```sh
   STATE="$HOME/.local/share/nsw-fire-coverage"
   mkdir -p "$STATE"
   # Create only on first setup; do not overwrite an existing configuration.
   if [ ! -e "$STATE/server.json" ]; then
     printf '%s\n' \
       '{"host":"127.0.0.1","port":8080,"dataDirectory":"./data","updaterEnabled":true,"liveFeedsEnabled":true,"feedPollingSeconds":{},"maxImportBytes":8589934592}' \
       > "$STATE/server.json"
   fi
   node generated-artifacts/standalone-macos/shared/payload/app/server.mjs \
     --config "$STATE/server.json"
   ```

4. Keep that terminal running and open **http://localhost:8080/**. Check `http://localhost:8080/api/healthz`; GIS is at `/workspace`. Ctrl+C stops this foreground server.

Build first, then launch: running raw source alone will not provide the bundled imports, web assets and portable-engine layout. Do not try to execute the Windows `.exe` or Mac Mach-O runtimes on Linux.

This example intentionally binds to loopback and runs as your user, not root. For unattended service/boot operation, an administrator must separately provision a dedicated user, stable application path, persistent state permissions, logs and an appropriate service definition. **No tested Linux service installer is supplied.** Rebuilding replaces staging output; stop any server using it first and preserve state elsewhere. To remove a manual setup, stop its process and remove only the application files; retain/back up state unless separately approved for deletion.

## Configuration and network access

| Item | Windows default | macOS default |
| --- | --- | --- |
| Program | `C:\Program Files\NSW Fire Coverage\` | `/Library/Application Support/NSW Fire Coverage/` |
| Persistent state root | `C:\ProgramData\NSW Fire Coverage\` | `/Library/Application Support/NSW Fire Coverage Data/` |
| Configuration | `<state-root>\server.json` | `<state-root>/server.json` |
| Data | `<state-root>\data\` | `<state-root>/data/` |
| Logs | `<state-root>\logs\` | `<state-root>/logs/` |
| Initial binding | `0.0.0.0:8080` | `0.0.0.0:5400` |

The Windows default configuration is below; use **5400** for a new Mac installation:

```json
{
  "host": "0.0.0.0",
  "port": 8080,
  "dataDirectory": "./data",
  "updaterEnabled": true,
  "liveFeedsEnabled": true,
  "feedPollingSeconds": {},
  "maxImportBytes": 8589934592
}
```

- `dataDirectory` is relative to `server.json` unless absolute. Preserve service-account permissions if moving it.
- `updaterEnabled` controls the scheduled **permit-table** refresh.
- `liveFeedsEnabled` separately controls automatic polling of the **five feeds**.
- `feedPollingSeconds` accepts per-feed overrides from **60–604800 seconds**, using `incidents-json`, `incidents-xml`, `danger-xml`, `danger-rss`, `major-updates`.
- `maxImportBytes` is the upload cap, not a conversion-capacity guarantee.
- For a machine-only installation, set `host` to **127.0.0.1**. Apply changes with `Restart-Service NSWFireCoverage` on Windows or `sudo launchctl kickstart -k system/au.nswfirecoverage.standalone` on Mac. Restart the foreground process for Linux.
- After changing a port, update bookmarks, installed shortcuts, firewall and reverse-proxy rules.

### LAN access and security

On an approved LAN, browse to `http://<server-name-or-LAN-IP>:<port>/`. Wired and Wi-Fi work, subject to firewall, guest-network isolation, VLAN and endpoint-security rules. The server **and browsers** need access to the official services.

**There is no user login or per-project authorisation. Anyone able to access the standalone HTTP service can change GIS projects. Do not expose it directly to the public internet.** Cross-origin mutation checks and upload validation do not replace authentication. Use a trusted machine/private network, or an organisation-approved authenticated TLS reverse proxy with the backend bound to loopback. Serve the application at the site's root.

No broad firewall exception is installed automatically. Windows includes an optional reviewed local-subnet, Domain/Private-profile rule:

```powershell
& 'C:\Program Files\NSW Fire Coverage\operator\Allow-LanAccess.ps1'
```

On Mac, arrange approved access for the native bundled executable/configured port through the organisation's firewall policy. Browser geolocation outside localhost may need HTTPS; address search and dropped pins do not require browser geolocation.

Scripts, styles, system fonts and conversion assets are local in standalone builds. Public spatial lookups necessarily transmit searched locations/coordinates to their official services. Third-party service availability/access policies still apply.

## Data storage, backup, upgrades and removal

```text
<state-root>/
  server.json
  logs/
  data/                         # or your configured dataDirectory
    rfs-cache.json
    live-feeds/
    gis-projects/<project-id>/
      project.json
      Sources/<import-id>/...
      Sources/<import-id>.manifest.json
      Working/...               # GeoJSON plus SQLite indexes in newer builds
      Exports/...               # GeoJSON and separate provenance files
    gis-trash/...
```

### Backup and upgrade

1. Stop the service to obtain a consistent backup, especially for SQLite.
2. Back up **`server.json` and the entire resolved `dataDirectory`** to a separate location. Include every Working file, Sources, Exports, GIS trash and caches—not just original imports or application binaries. Retain the previous installer/checksum.
3. Follow the native pilot before managed rollout, then install a higher version through the normal platform installer.
4. Confirm service health, the configured port, saved project visibility, working edits, exports and feed dates.

In indexed builds, **the SQLite working index is authoritative after edits**; the original GeoJSON snapshot is not an edited backup. Never discard an index and rebuild from old Sources to “repair” a project. The native scripts/runbook verify data preservation when executed on their targets; that verification is still pending, so preservation is a design intent, not a completed rollout certification.

### Uninstall

Windows, using Apps/Programs or an elevated terminal:

```powershell
msiexec.exe /x "NSW-Fire-Coverage-1.1.0-x64.msi" /qn /norestart
```

Mac:

```sh
sudo "/Library/Application Support/NSW Fire Coverage/operator/uninstall.sh"
```

Removal is designed to delete the program/service while **retaining local state, configuration, projects, caches and logs**. The disabled-login Mac service account is retained to preserve ownership. Deleting retained data/accounts is a separate administrator action after a verified backup—not part of ordinary uninstall. Remove any optional Windows firewall rule separately if retiring the server.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Site does not open locally | Service running? Correct default/custom port? `GET /api/healthz` should return `{"status":"ok"}`. Inspect local logs and installer logs. |
| Service fails to start | Port collision, invalid JSON/config values, blocked unsigned runtime, missing Windows .NET prerequisite or state-directory permissions. Do not grant program directories broad write access. |
| Local site works but LAN access fails | Bind address, firewall, profile, VLAN/guest isolation and client route. `localhost` on another computer refers to that computer, not the server. |
| Map/address/boundary lookup fails | Internet/proxy policy and official NSW service availability. Cached GIS data is not an offline address/boundary database. |
| Permit/feed data is old or HTTP 403 is shown | Last-good data is deliberately retained. Inspect timestamps and source availability; do not bypass access controls or interpret stale data as current. |
| `.lyr` does not display features | It is a reference, not the underlying dataset; import linked supported vector data. |
| Map shows fewer features than expected | In current source the preview is bounded; use attributes/extent controls. Complete saved-layer exports are separate from map previews. |
| Large conversion fails | Upload allowance is not engine capacity. Check geometry complexity, WASM limits, scratch disk space and logs; use a smaller representative layer. |
| Export is blocked | Review invalid geometry/CRS/topology warnings. Data is not silently repaired or published partially. |
| Index is missing after edits | Preserve all files and backups; do not reconstruct edited data from an old snapshot. |

For an intentional permit-table retry without concurrent cache writers:

```powershell
# Windows: briefly stops the service and restores its prior running state.
& 'C:\Program Files\NSW Fire Coverage\operator\Refresh-Rfs.ps1'
```

```sh
# macOS equivalent
sudo "/Library/Application Support/NSW Fire Coverage/operator/refresh-rfs.sh"
```

For Linux manual administration, stop the foreground server before running the same bundled server entry point with `--config <path> --refresh-rfs`, then restart normally. Do not run multiple processes writing the same state directory.

## Build and verification

Use pnpm from the repository root. Source, configuration and installer definitions live under `Stand-alone/`; generated staging/packages are not normal source files.

### Windows MSI cross-build

Build host: Linux/WSL, Node 22+, pnpm, Python 3 and `wixl`/msitools **0.106+**:

```sh
pnpm install --frozen-lockfile
node Stand-alone/scripts/build.mjs
node --test Stand-alone/tests/*.test.mjs
```

`--skip-msi` skips MSI compilation but still prepares the Windows payload. `--shared-only` produces the runtime-independent payload used in the Linux example and Mac build.

### macOS package cross-build

The documented Linux build also needs a C++11-capable compiler, GNU cpio, xar and BOM inspection tooling:

```sh
node Stand-alone/macOS/scripts/build.mjs
python3 Stand-alone/macOS/tests/package_test.py
```

Apple-tool repackaging/signing on an authorised Mac is described in the [Mac guide](Stand-alone/macOS/README.md). Signing/notarization credentials must not be committed.

Both builders default to version **1.1.0**. Use a new higher three-part version for new release binaries, for example:

```sh
INSTALLER_VERSION=1.2.0 node Stand-alone/scripts/build.mjs
INSTALLER_VERSION=1.2.0 node Stand-alone/macOS/scripts/build.mjs
```

Outputs go to ignored `Stand-alone/dist/` and `generated-artifacts/` staging directories. `standalone-installers/` contains the supplied distributable copies, checksums and release-specific guides. A source change alone does not rebuild those copies.

Runtime/engine downloads are checksum-pinned. Builds emit a per-file `BUILD-MANIFEST.json` and third-party notices. Keep those notices and the replaceable portable engine files with distributions. Package inspection, runtime tests, GIS regression tests and benchmarks are distinct from native installer acceptance; see the [native pilot runbook](Stand-alone/tests/NATIVE-UPGRADE-PILOT.md) for the required four-target evidence.

## Repository layout

| Path | Purpose |
| --- | --- |
| `artifacts/nsw-fire-district-checker/` | React/Vite checker and standalone GIS frontend |
| `artifacts/api-server/` | Hosted API, permit scraper and hosted refresh tools |
| `lib/fire-data/` | Shared interpretation, dated reference data and source contracts |
| `lib/db/` | Hosted PostgreSQL schema; not required by standalone installations |
| `Stand-alone/src/` | Local server, GIS storage/indexing, conversion worker and caches |
| `Stand-alone/installer/`, `Stand-alone/service/` | Windows MSI generation and service wrapper definition |
| `Stand-alone/operator/` | Windows administrator scripts |
| `Stand-alone/macOS/` | Mac build, launchd, installer and operator scripts |
| `Stand-alone/tests/`, `Stand-alone/windows/tests/` | Runtime/GIS tests and staged native upgrade harness |
| `standalone-installers/` | Supplied MSI/PKG, checksums and release guides |
| `generated-artifacts/` | Ignored build/test/benchmark output |

## Attribution and limitations

- Keep the NSW Department of Customer Service attribution visible when using the map.
- NSW service availability, response formats, and datasets may change.
- Coverage classifications depend on the live FRNSW district layer and the app's NSW locality check.
- **Rural Fire District** is an inference where no mapped FRNSW district intersects a confirmed NSW point; it must not be treated as an official RFD boundary determination.
- RFS Fire Permit Yes/No, regional Fire Danger Ratings, Total Fire Bans and emergency incidents are different datasets and must not be substituted for one another.
- The supplied statewide GURAS CSV attributes are not a geometry-bearing offline geocoder.
- Nearby station distance does not determine dispatch responsibility. Station phone numbers are on official profiles; station-specific emails are not provided by the locations layer.
- Data/service licences and attribution requirements still apply; inclusion in this repository does not transfer ownership of official datasets.
- See packaged `THIRD-PARTY-NOTICES.txt` and upstream notices for Node, WinSW, the portable GDAL/OGR engine and its components. There is no claim that every third-party component uses the application package's licence.
