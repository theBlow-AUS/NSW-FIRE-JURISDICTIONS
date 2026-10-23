---
name: FRNSW station contacts
description: Official FRNSW station locations, profile links, and contact-data limits.
---

FRNSW's public `FRNSW_Locations` FeatureServer station layer publishes station names, station numbers, addresses, and coordinates, but not phone or email fields. Station numbers map to the official station profile pages, where phone numbers are published. Station-specific emails were not present in the official station index or inspected station profiles.

**Why:** Direct official-source research found the station profiles and station map layer, while automated requests to the profile site were blocked.

**How to apply:** Use the public layer to calculate closest stations by direct distance, clearly distinguish those from an assigned response station, and link each profile for phone details. Do not substitute a shared FRNSW email for a station-specific contact. The feature-service endpoint currently permits browser requests from the `file://` null origin, allowing the single-file local HTML to fetch station locations.
