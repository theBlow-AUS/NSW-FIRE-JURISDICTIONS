---
name: Local HTML exports
description: Locked-down workstation requirement and pitfalls when producing single-file local copies.
---

The downloadable local copy must open by double-clicking an HTML file, without installing Node.js or running a server. Put it in a folder named `LOCAL HOST`. Live GURAS and map-data requests are allowed.

**Why:** The user has a locked-down SoE and explicitly rejected a Node-based launcher.

**How to apply:** Keep scripts, styles and icons inside the HTML; test the actual `file:` launch mode and `Origin: null` access to public services. Do not assume the hosted app's URL router will work against a filesystem path.

When embedding compiled bundles into HTML, use replacement callbacks rather than replacement strings.

**Why:** Bundled JavaScript can contain `$&` and similar replacement tokens. String replacement interprets those tokens and silently corrupts the embedded bundle.

**How to apply:** Compare the extracted inline script with the original bundle, and exclude generated HTML exports from CSS source scanning to avoid repeatedly scanning the previous compiled output.

Do not assume a GURAS CSV export contains point locations just because a coordinate system was selected.

**Why:** A statewide portal export supplied by the user contained all address attributes and relationship identifiers but no coordinates or geometry in any layer. A shape UUID is not geometry.

**How to apply:** Inspect headers before building an offline index. Offline geocoding needs a geometry-bearing AddressPoint export (or explicit longitude/latitude columns), joined to address attributes as necessary.
