---
name: Fire coverage interpretation
description: User scope, boundary interpretation, and public NSW ArcGIS access constraints.
---

The user wants a NSW address/map-pin checker that distinguishes FRNSW and Rural Fire District coverage, with results explicitly indicative because boundaries can change.

**Why:** The user specified this scope and accuracy limitation.

**How to apply:** Keep the limitation visible alongside results. A successful empty FRNSW polygon query can support an inferred RFD result only after confirming the point is in NSW; service errors must never become rural results.

The user wants the tool, not sales-style introductory content: search above the map, the map near the top, and coverage results both at the pin and below the map. Rural results should be headed "Rural Fire District" without "(indicative)".

**Why:** The user explicitly requested these presentation rules.

**How to apply:** Keep the general accuracy warning and inferred-coverage explanation separate from the Rural Fire District heading.

The user wants house-number street-address lookup using NSW GURAS, not a general place-name geocoder.

**Why:** The user explicitly requested the NSW GURAS spatial dataset for addressing.

**How to apply:** Use official GURAS-backed services. Never silently substitute a different house number; NSW's address service can return the nearest number when an exact match is absent. Address points identify properties, not necessarily dwelling locations.

The supplied FRNSW_Stations MapServer sharing URL cannot reliably support point queries. Its public MapServer exposes metadata but query and identify operations returned server errors. NSW's sibling FRNSW_Locations FeatureServer exposes a working Fire_Districts polygon layer with the same district names and geographic extent.

**Why:** Multiple metadata, query, and identify approaches failed on the supplied tile-oriented service; the query-enabled public sibling returned a Sydney district hit and an empty rural-point result.

**How to apply:** Prefer query-enabled authoritative feature services for point intersection. Preserve attribution and be explicit that RFD coverage is inferred from exclusion, not a separate rural-boundary test.
