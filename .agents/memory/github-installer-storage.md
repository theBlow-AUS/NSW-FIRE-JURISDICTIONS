---
name: GitHub installer storage
description: GitHub API write access does not guarantee Git LFS upload capability through the available proxies.
---

Verify Git LFS object upload support before pushing installer pointer files. Repository write permission by itself does not establish LFS capability.

**Why:** The workspace's internal Git proxy rejected the LFS batch endpoint as repository/object not found, while the GitHub App connector could read repository write permissions but could not reach GitHub.com's separate LFS origin. API access and Git LFS transport are distinct capabilities.

**How to apply:** Recheck current transport support early when publishing large installers. Do not push pointers without uploaded objects, bypass connector host restrictions, or interpret the LFS failure alone as invalid GitHub credentials. If considering ordinary Git instead, explain the persistent repository-history size increase before proceeding.

The user approved pushing the current macOS and Windows x64 installer files as ordinary Git files, adding approximately 109 MB to repository history.

**Why:** Git LFS upload was unavailable through the connected transports, and the user explicitly accepted the repository-size tradeoff.

**How to apply:** Keep these installers as actual binary blobs in `standalone-installers`, not unavailable LFS pointers. Explicitly disable LFS filtering for them so checkpoint-generated attributes cannot silently change their storage format.
