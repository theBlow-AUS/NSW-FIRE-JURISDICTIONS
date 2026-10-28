---
name: RSS map overlays
description: User-required feed defaults and the distinction between fire-weather overlays and jurisdiction boundaries.
---

For both the website and standalone checker, `https://www.rfs.nsw.gov.au/feeds/majorIncidents.xml` starts off. `https://www.rfs.nsw.gov.au/feeds/fdrToban.xml` starts on at adjustable **30% transparency**, meaning **70% opacity**, not 30% opacity.

**Why:** The user explicitly requested these defaults.

**How to apply:** Preserve saved user choices on reload; do not reset them when feeds refresh or change the transparency interpretation during UI changes.

Feed configuration is per-browser, not a server-global list controlled by whichever visitor last edited it.

**Why:** There is no user-account/administrator model for this shared checker. One visitor adding a feed should not change everyone else's map.

**How to apply:** Keep this distinction explicit if introducing shared feed catalogues or authentication later.

The RFS fire-danger XML has no polygons. Use existing fire-weather geometry, not reconstructed council unions or FRNSW fire districts. The BOM geometry distributed by Esri Australia is a separate, attributed reference source; matching requires district number and name, with the explicit ACT/Australian Capital Territory alias.

**Why:** RFS council lists can describe partial councils, so they cannot safely reconstruct weather-region boundaries. Weather overlays must never override authoritative FRNSW coverage or year-round permit requirements.

**How to apply:** Leave missing/ambiguous matches unplotted with warnings. Keep geometry attribution/generalization visible and preserve ordinary map panning and coverage-pin interaction beneath overlays.
