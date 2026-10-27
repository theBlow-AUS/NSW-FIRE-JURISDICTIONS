# Large-layer capacity and regression checks

## Scope and storage

Large layers no longer require a whole-layer browser object. The server keeps full
WGS84 working records in a disk-backed SQLite index with an RTree geometry index.
The bundled Node runtime supplies SQLite; no external database service, native
add-on installation or Replit service is required. Original uploads and their
SHA-256 manifests are retained unchanged.

The browser requests attribute pages, a full selected feature, and geometry
intersecting its current viewport. Record ordinals, not possibly duplicated source
IDs, identify edits. A single save transaction applies sparse feature changes and
metadata, increments a revision, and refuses stale writers. Project metadata can
be recovered from the committed working index after an interrupted manifest write.
An edited index must **not** be rebuilt from its original working snapshot.

Exports read the entire saved index in ordinal order, regardless of preview,
visibility, search or pagination. Each batch is structurally validated, checked
by GDAL/GEOS `ST_IsValid`, normalized to RFC 7946, and written with backpressure.
A fresh child process is used for each validation batch so WASM memory is released.
Batch and whole-layer feature counts are checked before the download is served.
Council enrichment and its provenance counts cover all batches. A failed export
does not expose a partially validated download.

## Explicit limits

| Operation | Limit / behavior |
| --- | --- |
| Source upload | 8 GiB default; administrator-configurable up to 32 GiB. Upload bytes are streamed to disk. |
| One feature or root metadata value | 8 MiB UTF-8. Larger records fail explicitly, not partially import. |
| Layer field metadata | 2,000 distinct names, with 1 MiB total UTF-8 name bytes. |
| Attribute API page | 100 rows default, 200 maximum; 2 MiB properties budget, except one larger record is returned alone to ensure forward progress. |
| Search | Server-side substring search over properties and source ID; 300 characters maximum. No 500-result ceiling. Search still scans attributes and can be slower than ordinary paging. |
| Geometry preview | Bounding-box intersection, at most 1,000 features / 2 MiB per layer. Spatially intersecting large individual geometries may be omitted, with a visible warning; complete selected geometry remains available through attributes. |
| Overlay geometry | At most eight other visible layers, each independently bounded. UI explicitly reports extra layers. |
| Save | 16 MiB request / 100 changed records; optimistic revision check and atomic transaction. Whole-layer PUT is rejected with HTTP 410. |
| Export validation batch | At most 10,000 records or 8 MiB serialized feature bytes. The enclosing JSON adds a small framing overhead. |
| Conversion subprocess | 15-minute timeout and 4 GiB Node old-space ceiling. WASM has its own address-space limits; increasing the Node heap does not remove them. |
| Mutation concurrency | One import, edit, removal or export at a time. Concurrent attempts receive HTTP 409; read APIs remain available. |
| Total export duration | Not limited to 15 minutes: each individual batch has that timeout. Export duration scales with records, vertices and disk speed. |

WGS84 GeoJSON is indexed as a stream. Projected GeoJSON, FileGDB and KML/KMZ still
need the isolated portable GDAL import process. **The FileGDB import itself is not
an unlimited-memory streaming database reader.** The complete source conversion
can still exceed WASM capacity or the timeout. Such failures are reported, and the
uploaded source is retained. The map and full export paths do not inherit a
10,000-feature ceiling.

Disk use includes original uploads, the initial WGS84 snapshot, the full working
index, completed exports/provenance, and one bounded temporary validation batch.
Back up the entire project directory. Completed exports accumulate until the
administrator archives them; no automatic retention deletion is performed.

## Reproducible generated benchmark

From the project root:

```sh
node Stand-alone/scripts/build.mjs --shared-only
node Stand-alone/scripts/benchmark-gis.mjs 100000
node Stand-alone/scripts/benchmark-gis.mjs 500000
```

The argument is the number of records **per layer**. Each run creates a real
two-layer FileGDB: points and closed rectangular polygons, each with name, council
and a 64-character payload attribute. Source generation is isolated from measured
service memory. The benchmark uploads files using a stream, imports the FileGDB,
requests a viewport and final attribute page, searches for the last record, edits
that record, exports both layers with real topology validation, then scans each
full export and verifies the final edit and complete record count.

Reports and fixture bytes stay under ignored
`generated-artifacts/gis-benchmark/<count>/`; `report.json` contains all measurements.
Set `GIS_TEST_APP_DIR` to test a different built app directory. Use the bundled Node
runtime to qualify installer runtime compatibility. Memory uses
`process.resourceUsage().maxRSS`: main service and largest converter peaks are
reported separately. Their sum is a conservative combination of distinct process
peaks, not a measured simultaneous total. Generator memory is excluded.

### Measurements

Linux x64, approximately 8 GiB host RAM, measured 2026-10-27. These are single-run
observations, not cross-platform service guarantees.

| Dataset | Runtime | Import both layers | Main peak RSS | Largest converter peak RSS |
| --- | --- | ---: | ---: | ---: |
| 2 × 100,000 records | Node 24.22.1 | 21.02 s | 306.9 MiB | 306.6 MiB |
| 2 × 500,000 records | Bundled Node 22.23.4 | 121.70 s | 226.4 MiB | 280.6 MiB |

| Records per layer | Layer | Viewport | Final page | Last-record search | One edit | Complete validated export | Export / index size |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100,000 | Points | 6.0 ms | 114.8 ms | 122.6 ms | 212.5 ms | 12.45 s | 22.18 / 47.86 MiB |
| 100,000 | Polygons | 7.0 ms | 150.3 ms | 201.2 ms | 239.7 ms | 18.18 s | 29.95 / 57.38 MiB |
| 500,000 | Points | 9.4 ms | 263.1 ms | 765.3 ms | 1.02 s | 66.92 s | 111.74 / 239.19 MiB |
| 500,000 | Polygons | 10.6 ms | 427.2 ms | 725.1 ms | 1.40 s | 95.09 s | 150.62 / 287.04 MiB |

The 100,000-record run preceded an optimization that avoids substring scans for
unfiltered attribute pages, so its final-page timing is conservative.
Different Node versions and concurrent browser verification also affect these
measurements; do not interpret the lower million-record memory peak as a claim
that larger projects always use less memory. Both cases exported every record,
including the final saved edit, without increasing batch or preview budgets.

Capacity depends on feature byte size, vertex count, attribute width, engine
constraints and disk performance—not just feature count. Simple generated
rectangles are not representative of every production parcel dataset. Native
Windows and Intel/Apple Silicon Mac memory/performance qualification is separate
from these Linux measurements.

## Regression coverage

```sh
GIS_TEST_APP_DIR=generated-artifacts/standalone-macos/shared/payload/app \
  node --test Stand-alone/tests/gis-feeds.test.mjs Stand-alone/tests/gis-large.test.mjs
```

Checks cover:

- Chunk boundaries, Unicode, escaped delimiters, malformed/truncated GeoJSON,
  oversized features, and a single GeoJSON Feature.
- Multi-layer imports; full 12,050-record exports despite a 1,000-record preview;
  null geometries and access beyond the former 500-match limit.
- Edits outside the preview; spatial-index movement; restart persistence; duplicate
  source IDs; stale revision conflicts; atomic rollback of invalid multi-edits.
- Full enrichment/provenance counts across multiple export batches and unchanged
  SHA-256 source bytes.
- Byte budgets independently of row limits, and matching HTTP pagination/edit
  contracts using a sub-kilobyte sparse update.
- Rejection of invalid topology, with no partially published export; refusal to
  silently rebuild a missing edited index from an older snapshot.
- Lazy indexing of legacy working copies and projected-GeoJSON reprojection.

Per-feature geometry validity does not validate geodatabase relationships,
attachments, domains, or cross-feature topology constraints.
