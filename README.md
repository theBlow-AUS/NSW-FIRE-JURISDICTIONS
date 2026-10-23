# NSW Fire District Checker

A map-based checker for looking up a NSW property address or dropping a pin and seeing whether the location intersects a mapped Fire and Rescue NSW (FRNSW) fire district. If a point is confirmed to be in NSW and no FRNSW district polygon is returned, the app labels the result **Rural Fire District**. This is an indicative inference, not a check against an authoritative RFD boundary.

## Features

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

## How coverage results work

The app sends the selected address or pin coordinates to the FRNSW district polygon layer and asks whether the point intersects a district feature:

1. A matching feature is reported as **Within an FRNSW fire district**, with the district name when available.
2. No matching feature is reported as **Rural Fire District** only when the location is confirmed as being in NSW. This is inferred from the absence of an FRNSW polygon hit; the app does not verify a separate RFD boundary.
3. If the point cannot be confirmed as being in NSW, or a service request fails, the app does not infer a rural result.

**FRNSW boundaries take priority over all LGA-based RFS information.** A positive FRNSW polygon hit suppresses RFS permit-table answers and RFS contact matches for that result. If the FRNSW boundary check fails, RFS information is withheld rather than used as a fallback classification.

The result is indicative only. Boundary data can change, mapped address points may not coincide with dwellings, and the checker does not confirm emergency response arrangements. In an emergency, call 000.

## Data sources and services

The browser requests data directly from the following public services; the app does not run its own geocoding or fire-boundary API.

| Purpose | Source |
| --- | --- |
| Address search | NSW Address Location Service, backed by the NSW Geocoded Urban and Rural Address System (GURAS): [`Address_Location`](https://mapsq.six.nsw.gov.au/services/public/Address_Location). [NSW dataset information](https://www.data.nsw.gov.au/data/dataset/address-location-service). |
| Nearby address point for a dropped pin | NSW Spatial Services GURAS ArcGIS layer 2: [`Guras/MapServer/2`](https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Guras/MapServer/2). |
| Locality, postcode, and state at a dropped pin | NSW Administrative Boundaries ArcGIS layer 0: [`NSW_Administrative_Boundaries/MapServer/0`](https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer/0). |
| FRNSW district coverage | NSW ArcGIS Feature Service `FRNSW_Locations`, layer 1: [`FRNSW_Locations/FeatureServer/1`](https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer/1). Layer 0 is the associated stations layer; the coverage check uses layer 1. |
| Map background | NSW Spatial Services cached NSW Base Map tiles: [`NSW_Base_Map/MapServer`](https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer). Copyright © NSW Department of Customer Service 2020. |
| Point-to-LGA lookup | NSW Spatial Services Administrative Boundaries, layer 1: [`LocalGovernmentArea`](https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer/1), queried with `esriSpatialRelIntersects` and EPSG:4326 coordinates. |
| RFS permit requirement | The **Council name / Fire Permit required** HTML table on the official [Bush Fire Danger Period and Fire Permits page](https://www.rfs.nsw.gov.au/fire-information/BFDP). |
| RFS district and Fire Control Centre contacts | A dated snapshot of the official [Fire Control Centres directory](https://www.rfs.nsw.gov.au/about-us/fire-control-centres), matched by published LGA name, not proximity. |

The search requests EPSG:4326 coordinates. Pin reverse lookups use the GURAS point service and NSW locality boundaries. If a nearby GURAS address point is displayed, the coverage check still uses the exact dropped-pin coordinates.

### RFS interpretation and refreshes

The RFS table reports **whether a fire permit is required**, not a field explicitly labelled “BFDP Active/Inactive”. The checker preserves the source wording and does not claim an independently verified legal BFDP declaration. A No answer is not permission to burn. Total Fire Bans, Fire Danger Ratings, council restrictions and other rules are separate; this feature does **not** use `fdrToban.xml`.

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

## Attribution and limitations

- Keep the NSW Department of Customer Service attribution visible when using the map.
- NSW service availability, response formats, and datasets may change.
- Coverage classifications depend on the live FRNSW district layer and the app's NSW locality check.
- **Rural Fire District** is an inference where no mapped FRNSW district intersects a confirmed NSW point; it must not be treated as an official RFD boundary determination.
