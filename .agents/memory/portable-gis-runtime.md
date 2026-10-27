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
