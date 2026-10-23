---
name: RFS source interpretation and dated data
description: Why the checker preserves permit-table wording and permits dated snapshots with visible refresh failures.
---

The official RFS BFDP page's council table reports “Fire Permit required” Yes/No, not an explicit BFDP Active/Inactive field. Preserve that distinction and never turn No into permission to burn.

**Why:** The user accepted dated data with visible refresh warnings after being told that this source does not directly declare BFDP status and direct automated access receives a Cloudflare HTTP 403 challenge.

**How to apply:** Retain the last successful dated snapshot when the source blocks access or changes structure. Show its retrieval date and the failed attempt rather than implying live confirmation. Do not bypass the access challenge or substitute Total Fire Ban/Fire Danger Rating feeds.

The downloadable HTML must remain useful without reaching the hosted API; its RFS information is a dated export, not a promise of background updates.

**Why:** The user explicitly chose the dated-snapshot approach while retaining the locked-down, double-click HTML requirement.

**How to apply:** Include refresh warnings at export and explain that a fresh export is needed for newer RFS data. Live address, boundary and map calls remain allowed.
