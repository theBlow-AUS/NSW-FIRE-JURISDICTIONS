# Local GIS workspace and RFS feeds

Available from the **1.1.0 standalone installers** for Windows x64 and macOS Intel/Apple Silicon. Open the installed checker and choose **Local GIS & live feeds**, or visit `/workspace`. The hosted checker and double-click `LOCAL HOST` HTML export do not provide this server-backed workspace. Release 1.2.0 adds [configurable RSS layers](RSS-FEEDS.md) to the main checker map in both website and standalone editions.

## Local projects

Create a project, then choose either GIS files or a `.gdb` directory:

- **File Geodatabase:** select the whole `.gdb` directory, or upload a `.gdb.zip` containing that directory. GDAL OpenFileGDB enumerates the vector layers, including feature classes within feature datasets. Layers are presented individually; feature-dataset hierarchy, relationships, attachments, domains and geodatabase rules are not recreated in GeoJSON.
- **KML / KMZ:** local features are converted. External network links and external XML entities are not supported. Embedded styling, icons and tours are not reproduced.
- **GeoJSON:** WGS84 feature data is validated and indexed as a stream. Legacy CRS declarations are transformed through GDAL, with the source CRS retained in provenance.
- **ArcMap `.lyr`:** retained unchanged as a layer reference, with a visible warning. A `.lyr` is not the underlying feature dataset. Supply its linked `.gdb`, KML or GeoJSON too. Binary ArcMap references and exact Esri symbology are not rendered or converted.

Every import retains the original uploaded bytes and a SHA-256 source manifest. The service stores:

```text
<dataDirectory>/
  gis-projects/<project-id>/
    project.json
    Sources/<import-id>/...
    Sources/<import-id>.manifest.json
    Working/...
    Exports/...
  gis-trash/...
  live-feeds/...
  rfs-cache.json
```

Source files are never edited through the UI. Layer names, visibility, colour, opacity, attributes and GeoJSON geometry are edited on working copies. Apply feature JSON changes, then **Save working copy**. Feature edits and layer metadata commit together in a local SQLite transaction, with revision checks preventing stale saves from overwriting someone else's edits. Stable zero-based record ordinals distinguish features even when source IDs are absent or duplicated. A save sends only changed features, not the map preview.

Existing projects are indexed lazily from their full working GeoJSON on first access. New imports retain a WGS84 working snapshot and a disk-backed working index. **After edits, the SQLite working index is authoritative; the original snapshot is not an edited backup. Back up the whole data directory, including all Working files, not only Sources or the application binaries.** If an edited index is missing, the service refuses to recreate it from an older snapshot. Removing a layer keeps its original source; removing a project moves its directory to `gis-trash` for administrator recovery.

The vector map draws local geometry without needing a basemap service. Zoom, pan or fit the layer to request geometry intersecting the current WGS84 viewport. Each layer preview has a 1,000-feature / 2 MiB budget; complex individual geometries can be omitted and the preview displays a warning. Other visible layers are bounded separately, with at most eight overlays. The paginated record list and server-side search reach **all** attributes, including records outside the map and records with null geometry. Selecting a record retrieves its complete geometry for editing. A draft is retained when searching, paging or changing the viewport; save it before switching layers/projects.

Attribute pages normally contain 100 records (API maximum 200), with a 2 MiB budget except that one larger record is allowed so paging always advances. Each feature is limited to 8 MiB; layer field metadata is limited to 2,000 distinct names / 1 MiB. Save requests are limited to 16 MiB and 100 feature edits. Save regularly when editing many records. Whole-layer PUT replacement is explicitly rejected, rather than accepting a truncated client preview. The default upload limit remains 8 GiB; it is not a promise that every FileGDB of that size will fit the conversion engine. See [large-layer limits and benchmark results](GIS-LARGE-LAYERS.md).

## GeoJSON exports

Exports use the **complete saved** working index, never the map preview or attribute page. The server streams records in bounded batches (at most 10,000 features / 8 MiB), checks coordinate ranges, rings and geometry structure, then checks topology using GDAL/GEOS `ST_IsValid` in a fresh conversion process per batch. Exports are normalized as RFC 7946 WGS84 GeoJSON. Feature counts must match at each batch and for the whole layer before a download is served. Invalid geometries block export and are not silently repaired. Validation is per geometry; it does not assert cross-feature/geodatabase topology rules.

The validated export is written to disk and streamed to the browser, not materialized as a whole-layer JavaScript object. Preview limits never limit exports. Exact council enrichment is applied per feature and its match counts are accumulated across every batch. Export files and provenance are published only after validation succeeds. Each conversion has a 15-minute timeout; a complete multi-batch export can take longer. Only one import/edit/export mutation runs at a time; reads remain available.

Download **Provenance** separately alongside the GeoJSON. Both files are also saved under the project's `Exports` directory. Provenance contains the source, CRS/WKT where available, import and export dates, transformation details, validation and any regional enrichment.

For regional fire-danger enrichment, select a field that you have confirmed contains council names. Only exact names, after case/punctuation normalization, are joined to the RFS council list. Unknown or ambiguous names are marked instead of being guessed. No region polygon is fabricated. Download **Join provenance** to retain match counts and feed freshness.

Live incidents can be downloaded as GeoJSON with their stable source identifiers and provenance/freshness properties. Non-spatial major-fire advisories and regional danger/ban records are available as JSON or CSV, with a separate feed provenance download.

## Official live feed sources

The local server fetches only these fixed HTTPS feed URLs:

| Source | URL | Default interval |
| --- | --- | --- |
| Current incidents, primary GeoJSON | https://www.rfs.nsw.gov.au/feeds/majorIncidents.json | 15 minutes |
| Current incidents, GeoRSS supplement | https://www.rfs.nsw.gov.au/feeds/majorIncidents.xml | 15 minutes |
| Fire danger and Total Fire Bans | https://www.rfs.nsw.gov.au/feeds/fdrToban.xml | 60 minutes |
| Fire danger and Total Fire Bans RSS | https://www.rfs.nsw.gov.au/feeds/fdrTobanRSS.xml | 60 minutes |
| Major Fire Updates | https://www.rfs.nsw.gov.au/feeds/major-Fire-Updates.xml | 15 minutes |

Incident records are deduplicated by source ID/GUID, with GeoJSON preferred. GeoRSS point and polygon footprints are read as WGS84. Major-fire advisories are not assigned made-up coordinates. Fire-danger XML is the primary regional source; RSS is used when no primary snapshot is available.

Each source has its own persisted raw/normalized last-good snapshot, conditional HTTP headers, last-attempt and last-success dates, source-update date when reported, and failure status. Browser reads do not trigger external fetches. Manual refreshes have a minimum one-minute cooldown. Failures preserve the last successful data and visibly mark it stale; a successful download does not guarantee that the agency's source is current.

The permit-table updater remains separate: its existing weekly Monday and first/last-day-of-month Sydney schedule is unchanged. **FRNSW boundaries override RFS information. FRNSW fire permits are required year-round.** Danger ratings, Total Fire Bans, incident feeds and permit requirements are different concepts. Results remain indicative; this is not an emergency dispatch or permission-to-burn system. In an emergency call 000.

## Configuration, network and security

Existing configurations are preserved on upgrade. Optional new keys:

```json
{
  "liveFeedsEnabled": true,
  "feedPollingSeconds": {
    "incidents-json": 900,
    "incidents-xml": 900,
    "danger-xml": 3600,
    "danger-rss": 3600,
    "major-updates": 900
  },
  "maxImportBytes": 8589934592
}
```

Feed intervals must be 60–604800 seconds. Set `liveFeedsEnabled` to `false` to disable automatic live-feed polling; set `updaterEnabled` to `false` separately to disable the permit scraper. Cached GIS layers/feeds remain readable offline. The original address/coverage checker still needs the official NSW addressing, boundary and map services unless an existing cached response suffices.

All project storage, conversion, scheduling and HTTP serving run on the installed machine. **No Replit runtime, Replit database, CDN GIS engine or separate Node/GDAL installation is required.** The installers include the portable GDAL/OGR WebAssembly engine and native Node runtimes. Engine files are version/checksum-pinned and separately replaceable; see the included third-party notices and `app/vendor/gdal/SOURCE.txt`.

The service is intended for a trusted machine/private LAN. It has no user authentication: users who can access its HTTP port can change local GIS projects. Cross-origin browser mutations are rejected, upload paths are checked, archives are read through GDAL's virtual filesystem rather than extracted into arbitrary paths, and XML external entities are rejected. Do not expose this unauthenticated service directly to the internet. Use an organisation-approved authenticated reverse proxy/TLS and network restrictions if required.

Windows retains port **8080**. macOS retains port **5400**, with native Intel/Apple Silicon runtimes. Installers are unsigned; the macOS package is not notarized. Native installation, service startup, upgrade and uninstall need pilot validation on target operating systems before managed rollout.

## Build and checks

```sh
node Stand-alone/scripts/build.mjs
node --test Stand-alone/tests/*.test.mjs
node Stand-alone/scripts/build.mjs --shared-only
GIS_TEST_APP_DIR=generated-artifacts/standalone-macos/shared/payload/app node --test Stand-alone/tests/gis-{feeds,large}.test.mjs
node Stand-alone/scripts/benchmark-gis.mjs 100000
node Stand-alone/scripts/benchmark-gis.mjs 500000
node Stand-alone/macOS/scripts/build.mjs
python3 Stand-alone/macOS/tests/package_test.py
```

`INSTALLER_VERSION` can override the default `1.2.0`. Package outputs go to the ignored `Stand-alone/dist` folder. The source tests cover all five feed formats, failure retention, deduplication, exact council joins, real local import/edit/export persistence, unchanged source bytes, cross-origin rejection, KML/KMZ and multi-layer FileGDB feature datasets. Cross-built packages are inspected on Linux; those checks do not replace native OS installation testing.
