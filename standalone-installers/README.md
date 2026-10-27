# Standalone installers

Locally hosted NSW Fire Coverage installers. No Replit runtime services or separate Node.js installation are required. Live official NSW data services still require internet access.

**Release 1.1.0** adds local GIS projects, FileGDB/KML/KMZ and GeoJSON imports, immutable source copies, saved working-layer edits, validated GeoJSON export/provenance, exact council-name enrichment and five independently cached live RFS feeds. `.lyr` files are retained as references; their linked feature data is required. See [the GIS workspace guide](GIS-WORKSPACE.md).

| Platform | Installer | Default address | Guide |
| --- | --- | --- | --- |
| macOS, native Intel and Apple Silicon | [Download PKG](NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg) | `http://localhost:5400/` | [macOS installation guide](macOS-README.md) |
| Windows 10 / Windows Server 2022, x64 | [Download MSI](NSW-Fire-Coverage-1.1.0-x64.msi) | `http://localhost:8080/` | [Windows installation guide](Windows-x64-README.md) |

Each installer has a matching `.sha256` file. Use GitHub's **Download raw file** button on the installer page to download the actual binary.

## Check the downloads

macOS:

```sh
shasum -a 256 -c NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg.sha256
```

Windows PowerShell:

```powershell
Get-FileHash .\NSW-Fire-Coverage-1.1.0-x64.msi -Algorithm SHA256
Get-Content .\NSW-Fire-Coverage-1.1.0-x64.msi.sha256
```

Compare the Windows hash with the supplied checksum.

## Compatibility and validation

- macOS technical minimum: **macOS 11 Big Sur**. Prefer a currently security-supported macOS version. This package is **unsigned and not notarized**.
- Windows target: **Windows 10 x64 and Windows Server 2022 x64**.
- These installers were cross-built and their payloads inspected on Linux. Native installation, service startup, upgrade and uninstall require pilot validation on the target operating systems before broader deployment.
- FRNSW boundaries take priority over RFS information; FRNSW permits are required year-round. Results remain indicative.
- Local GIS editing is unauthenticated. Use only a trusted machine/private LAN, or an organisation-approved authenticated reverse proxy. Do not expose this HTTP service directly to the public internet.

Build sources and detailed documentation remain in [`../Stand-alone/`](../Stand-alone/). This folder contains the ready-built installers, checksums and release-specific copies of their guides.
