---
name: Portable GIS runtime
description: Why standalone GIS uses a replaceable WebAssembly engine in short-lived local processes.
---

Keep GIS conversion local and run each conversion in a short-lived process rather than sharing one long-lived GDAL WebAssembly instance.

**Why:** Windows and both Mac architectures must work without a separately installed GDAL runtime or any Replit service. The JavaScript wrapper caches initialization and its output destination; shared instances risk filesystem collisions and retain WebAssembly memory between imports.

**How to apply:** Retain the separate, checksum-pinned engine assets and process boundary when extending import/export functionality. Benchmark large datasets before promising unlimited browser editing.

The Node wrapper's asset path must be relative to the process working directory, and input paths must use forward slashes even on Windows.

**Why:** This wrapper prefixes asset paths with `./` and splits source paths on `/`; passing ordinary absolute paths or native Windows separators can fail despite the files existing.

**How to apply:** Preserve explicit path normalization in packaging/conversion changes. Test the packaged engine rather than assuming generic GDAL or browser examples have the same path behavior.

Do not equate the upload-size ceiling or a larger Node heap with the size of FileGDB that the portable engine can convert.

**Why:** GDAL's WebAssembly address space and geometry complexity remain separate constraints even when browser reads and exports are bounded. The large-layer benchmark measures simple generated points and rectangles, not arbitrary production geodatabases.

**How to apply:** Keep capacity claims conditional on geometry/attribute complexity and target-machine measurements. Preserve the fresh-process boundary for each bounded export validation batch; do not combine batches into one engine session merely to reduce startup time.
