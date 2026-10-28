# RSS and live map layers — 1.2.0

The website and Windows/macOS standalone checkers share **RSS & live feed layers**, directly below the main address/pin map. The standalone GIS project's existing five-source RFS feed dashboard is unchanged.

## Defaults and controls

| Layer | Source | Initially visible | Initial transparency |
| --- | --- | --- | --- |
| RFS major incidents | https://www.rfs.nsw.gov.au/feeds/majorIncidents.xml | No | 0% |
| RFS fire danger and Total Fire Bans | https://www.rfs.nsw.gov.au/feeds/fdrToban.xml | Yes | **30%** |

Transparency is the amount of the basemap showing through: **30% transparency = 70% overlay opacity**. Each layer has its own on/off checkbox and 0–100% slider. Preferences, including added feeds, survive reload in this browser; they are not shared globally with other browsers/users. Clearing browser storage resets them.

Enter a layer name and a **public HTTPS RSS, Atom or GeoRSS URL** to add a feed. Custom feeds start off. They can be removed, refreshed, inspected as an entry list, or downloaded as GeoJSON. RSS without supported coordinates is still ingested: entries have null geometry and are never assigned guessed locations.

Supported map geometry: GeoRSS Simple point, line, polygon and box; W3C geo:lat/geo:long; multiple geometries in an entry. GeoRSS GML, arbitrary Esri XML and HTML pages are not interpreted as coordinates. The map preview is limited to 5,000 entries; the list shows 50. Ingestion is bounded to 10,000 entries and 4 MiB per source, with visible limit warnings. Downloads retain all ingested entries, including null-geometry advisories and freshness/provenance metadata.

## Fire-danger geography

`fdrToban.xml` is RFS FireDangerMap XML, not standard GeoRSS. It supplies region numbers, names, today's/tomorrow's ratings and bans, but **no polygons**.

The server retrieves existing **Bureau of Meteorology fire-weather district geometry distributed by Esri Australia**:

https://services1.arcgis.com/vHnIGBHHqDR6y0CR/arcgis/rest/services/Fire_Districts_-_4_Day_Forecast/FeatureServer/5

Only NSW/ACT districts for one forecast period are used; forecast rating fields from that service are not used. The RFS XML supplies the ratings. A geometry is assigned only when its district number and normalized name match, with the explicit ACT / Australian Capital Territory name alias. Missing/ambiguous matches remain unplotted and produce a warning.

Geometry is generalized to 0.002 degrees for display and cached for a day. Source attribution is visible beside the layer and included in downloads. This is a reference overlay, not a survey/mission-critical boundary product. Grey means no/unknown rating, green moderate, yellow high, orange extreme and red catastrophic. Purple outlines indicate a Total Fire Ban today.

**Fire-weather districts are not FRNSW fire districts.** These overlays never change address/pin coverage checks, FRNSW precedence, or the FRNSW year-round permit rule.

## Fetching, cache and safety

Both editions use the same server-side `GET /api/map-feeds?url=...` implementation. The browser polls the local API every five minutes; the server normally caches each feed for 15 minutes, so map toggles/sliders do not refetch external data. Manual refresh has a one-minute minimum cooldown. Off means hidden from the map, not unsubscribed from ingestion.

The hosted website shares a bounded in-memory cache across visitors. Standalone installations also persist last-good snapshots under `<dataDirectory>/map-feeds/`; refresh failure or loss of internet retains dated data with a visible warning, including when a browser request fails. GeoJSON downloads retain that stale/error status. A successful check is not a claim that the publisher has recently updated its source.

Only public DNS hostnames over HTTPS/443 are accepted. Credentials, IP literals, private/reserved DNS results, redirects, XML entities and DTDs are rejected. The validated IP is pinned to the TLS request to prevent DNS rebinding. Fetches have time/size/concurrency limits, same-URL calls share one download, and failures are briefly cached to prevent retry floods. This is not a general proxy to internal network services.

Standalone downloads and scheduling run on the installed host. No Replit service or separately installed runtime is needed. Live feeds and the fire-weather geometry service need internet access, but cached snapshots remain usable offline. Windows retains port 8080; macOS retains port 5400. The locked-down double-click `LOCAL HOST` HTML edition is unchanged and does not include the server-backed feed manager.

Standalone `liveFeedsEnabled: false` also blocks external fetches through this map-feed API. Previously saved map snapshots remain readable with a disabled/stale warning.

## Checks

```sh
node --test artifacts/api-server/src/lib/map-feeds.test.mjs
```

The shared tests cover parsing, null-geometry advisories, exact region joins/ACT naming, unsafe targets/XML, shared downloads, cooldowns, last-good fallback and standalone cache recovery.
