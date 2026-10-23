# NSW Fire District Checker

A map-based checker for looking up a NSW property address or dropping a pin and seeing whether the location intersects a mapped Fire and Rescue NSW (FRNSW) fire district. If a point is confirmed to be in NSW and no FRNSW district polygon is returned, the app labels the result **Rural Fire District**. This is an indicative inference, not a check against an authoritative RFD boundary.

## Features

- Search for a house-number street address with a suburb or postcode using NSW GURAS-backed addressing.
- Show the matched address on a map so the user can confirm the location.
- Drop or move a pin on the map to check a location independently of its nearest address.
- Show the coverage result both beside the pin and below the map.
- Reverse-check a dropped pin for its NSW locality and, when nearby, a GURAS property address point.
- Provide source links and explain when an address match was adjusted or a nearby point is being shown.
- Include a single-file local HTML build in the `LOCAL HOST` folder. It opens by double-clicking, with no local installation or server, but still needs internet access for live services.

## How coverage results work

The app sends the selected address or pin coordinates to the FRNSW district polygon layer and asks whether the point intersects a district feature:

1. A matching feature is reported as **Within an FRNSW fire district**, with the district name when available.
2. No matching feature is reported as **Rural Fire District** only when the location is confirmed as being in NSW. This is inferred from the absence of an FRNSW polygon hit; the app does not verify a separate RFD boundary.
3. If the point cannot be confirmed as being in NSW, or a service request fails, the app does not infer a rural result.

The result is indicative only. Boundary data can change, mapped address points may not coincide with dwellings, and the checker does not confirm emergency response arrangements. In an emergency, call 000.

## Data sources and services

The browser requests data directly from the following public services; the app does not run its own geocoding or fire-boundary API.

| Purpose | Source |
| --- | --- |
| Address search | NSW Address Location Service, backed by the NSW Geocoded Urban and Rural Address System (GURAS): [`Address_Location`](https://mapsq.six.nsw.gov.au/services/public/Address_Location). [NSW dataset information](https://www.data.nsw.gov.au/data/dataset/address-location-service). |
| Nearby address point for a dropped pin | NSW Spatial Services GURAS ArcGIS layer 2: [`Guras/MapServer/2`](https://maps.six.nsw.gov.au/arcgis/rest/services/sixmaps/Guras/MapServer/2). |
| Locality, postcode, and state at a dropped pin | NSW Administrative Boundaries ArcGIS layer 0: [`NSW_Administrative_Boundaries/MapServer/0`](https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer/0). |
| FRNSW district coverage | NSW ArcGIS Feature Service `FRNSW_Locations`, layer 1: [`FRNSW_Locations/FeatureServer/1`](https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/FRNSW_Locations/FeatureServer/1). Layer 0 is the associated stations layer; the coverage check uses layer 1. |
| Map background | OpenStreetMap standard raster tiles: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright). |

The search requests EPSG:4326 coordinates. Pin reverse lookups use the GURAS point service and NSW locality boundaries. If a nearby GURAS address point is displayed, the coverage check still uses the exact dropped-pin coordinates.

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

## Use the local HTML version

Open `LOCAL HOST/index.html` in a modern browser. It is a self-contained HTML file and does not require Node.js or a local web server. An internet connection is still required for address lookups, fire-district checks, and map tiles. Network policy or browser restrictions may prevent access to the public services.

## Attribution and limitations

- Keep the OpenStreetMap attribution visible when using the map.
- NSW service availability, response formats, and datasets may change.
- Coverage classifications depend on the live FRNSW district layer and the app's NSW locality check.
- **Rural Fire District** is an inference where no mapped FRNSW district intersects a confirmed NSW point; it must not be treated as an official RFD boundary determination.
