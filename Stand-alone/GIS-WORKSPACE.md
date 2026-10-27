# Local GIS workspace and RFS feeds

Available in the **1.1.0 standalone installers** for Windows x64 and macOS Intel/Apple Silicon. Open the installed checker and choose **Local GIS & live feeds**, or visit `/workspace`. The hosted checker and double-click `LOCAL HOST` HTML export do not provide this server-backed workspace.

## Local projects

Create a project, then choose either GIS files or a `.gdb` directory:

- **File Geodatabase:** select the whole `.gdb` directory, or upload a `.gdb.zip` containing that directory. GDAL OpenFileGDB enumerates the vector layers, including feature classes within feature datasets. Layers are presented individually; feature-dataset hierarchy, relationships, attachments, domains and geodatabase rules are not recreated in GeoJSON.
- **KML / KMZ:** local features are converted. External network links and external XML entities are not supported. Embedded styling, icons and tours are not reproduced.
- **GeoJSON:** imported through the same coordinate conversion. Source CRS information, where present, is retained in provenance.
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

Source files are never edited through the UI. Layer names, visibility, colour, opacity, attributes and GeoJSON geometry are edited on working copies. Apply feature JSON changes, then **Save working copy**. Saved revisions use new working files before updating the project manifest. Removing a layer keeps its original source; removing a project moves its directory to `gis-trash` for administrator recovery. Back up the whole data directory, not only the application binaries.

The vector map draws local geometry without needing a basemap service. It can display other visible layers and an optional live/cached incident overlay. The map preview is limited to 10,000 features, and the record list displays the first 500 search matches; exports retain the whole saved layer. The default upload limit is 8 GiB. A working-copy save request is limited to 256 MiB. Conversion runs in a separate, time-limited local process. Very large layers can exceed browser or WebAssembly memory; failures are reported rather than represented as successful imports.

## GeoJSON exports

Exports use the **saved** working copy. GDAL/OGR transforms imports to WGS84 longitude/latitude, and exports are normalized as RFC 7946 GeoJSON. The server checks coordinate ranges, rings and geometry structure, then checks topology using GDAL/GEOS `ST_IsValid`. Invalid geometries block export and are not silently repaired.

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
node Stand-alone/macOS/scripts/build.mjs
python3 Stand-alone/macOS/tests/package_test.py
```

`INSTALLER_VERSION` can override the default `1.1.0`. Package outputs go to the ignored `Stand-alone/dist` folder. The source tests cover all five feed formats, failure retention, deduplication, exact council joins, real local import/edit/export persistence, unchanged source bytes, cross-origin rejection, KML/KMZ and multi-layer FileGDB feature datasets. Cross-built packages are inspected on Linux; those checks do not replace native OS installation testing.
