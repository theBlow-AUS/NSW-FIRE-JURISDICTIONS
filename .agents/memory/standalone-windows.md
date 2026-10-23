---
name: Standalone Windows distribution
description: User-approved self-hosting scope and a WinSW/MSI service-recovery constraint.
---

The user wants a full MSI for Windows Server 2022 or Windows 10 x64, supporting wired or wireless networking, with its build source under `Stand-alone`. The installed application must run on their own machine without any Replit service connections. They explicitly approved live official NSW public-data calls.

**Why:** These are the user's stated deployment requirements and answers to the installer scope question.

**How to apply:** Keep this distribution separate from the locked-down workstation's double-click `LOCAL HOST` HTML. Bundle the runtime and local API/updater, use a durable local cache rather than the hosted database, and exclude development plugins and external font calls. Self-hosted does not mean fully offline in this distribution.

When Windows Installer registers a WinSW service directly, do not assume WinSW XML installation-time recovery settings have been applied to the Windows Service Control Manager.

**Why:** MSI ServiceInstall bypasses WinSW's own `install` command, where those service configuration settings are applied.

**How to apply:** Preserve explicit installer actions for SCM recovery configuration after service registration and before startup. Validate service registration, permissions, recovery, upgrade, and uninstall on native Windows before a broad rollout; Linux compilation and MSI table inspection alone do not prove Windows installation works.
