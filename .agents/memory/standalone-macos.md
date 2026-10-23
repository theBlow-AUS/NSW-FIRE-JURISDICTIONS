---
name: macOS standalone distribution
description: User requirements and compatibility boundaries for the self-hosted Mac installer.
---

The macOS installer must run locally without Replit services, support Intel and Apple Silicon, and use port **5400** by default. Live official NSW services remain allowed, as with the Windows standalone version.

**Why:** The user requested the same stand-alone installation for macOS, backwards compatible with Intel as far as reasonably possible, and explicitly rejected port 8080 for it.

**How to apply:** Keep both architectures native and bundle their runtimes. Preserve the Replit-independent server and public NSW calls; do not introduce a hosted backend requirement.

Use a maintained runtime instead of choosing an end-of-life runtime merely to reach older Intel macOS releases. Distinguish a binary's technical deployment minimum from ongoing Apple/Node security support.

**Why:** Node 22 binaries can target macOS 11, but that does not make Big Sur a currently security-supported production platform. Advertising the technical floor without that distinction would overstate support.

**How to apply:** Keep the compatibility floor and security-support caveat separate in release guidance. Native Installer/launchd testing still requires actual Macs; successful Linux archive inspection is not proof of native installation.
