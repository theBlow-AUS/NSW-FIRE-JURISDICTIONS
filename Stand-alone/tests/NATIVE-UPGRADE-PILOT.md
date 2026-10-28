# Native installation and GIS preservation pilot

## Coverage and release gate

As of 2026-10-27, this workspace is Linux x64. No authorised Windows or
macOS runner is attached. **No native installation, reboot, upgrade or uninstall
has been executed here.** Do not approve managed rollout using Linux results.

| Required native target | Fresh candidate | Previous → candidate | Real reboot / auto-start | Uninstall / retain data |
| --- | --- | --- | --- | --- |
| Windows Server 2022 x64 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Windows 10 x64 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Intel Mac, native x64 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Apple Silicon Mac, native arm64 | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

Run each row on an authorised disposable VM/Mac with administrator access.
Use supported, patched OS versions; the Mac binary compatibility floor is not
a security-support claim. Record the actual OS build and hardware, not just
“Windows” or “macOS”. Rosetta on Apple Silicon does not cover Intel hardware.
No CI dispatch, remote access, or paid runner provisioning is authorised by these
scripts. A GitHub connection alone is not evidence that target runners exist.

## Safety and prerequisites

- **The harness installs and uninstalls a system service and changes its
  configuration. Never use it on a real administrator workstation or project
  server.** `--disposable-machine` / `-DisposableMachine` acknowledges this.
- Snapshot a clean machine with neither application nor state directory nor
  service installed. The harness refuses existing state, including data left by
  an earlier uninstall. It never deletes that retained state. Restore the clean
  VM snapshot between the fresh-candidate and upgrade pilots.
- Copy this checkout and both release installers locally. Use 1.0.0 as previous
  and 1.1.0 as candidate for the supplied releases. Verify release `.sha256`
  files independently before execution. Actual package hashes, installed build
  manifests, OS information and stage results are recorded in evidence.
  Do not use Git LFS pointer files in place of real installers.
- Install Node 22+ as a **test runner dependency**. The application still uses
  its bundled runtime. Use elevated 64-bit PowerShell on Windows. On Mac ensure
  `sudo` can resolve your test Node binary, or run the `.mjs` harness directly
  with its absolute Node path. Do not install developer tools on rollout hosts.
- Keep evidence outside application/state directories, preferably in a new
  directory per target and pilot. It may contain local paths/system details;
  review logs before sharing. Store generated evidence in
  `generated-artifacts/native-upgrade/` when copying it into this checkout;
  that directory is excluded from Git/deployment.
- Keep default ports (8080 Windows / 5400 Mac) and custom pilot port 15400 free.
  Internet may be used by a fresh default installation. The upgrade fixture
  disables polling, so source outages cannot change its retention baseline.

## Windows Server 2022 and Windows 10

From an elevated PowerShell in the checkout (substitute your absolute paths):

```powershell
$Runner = '.\Stand-alone\windows\tests\upgrade-smoke.ps1'
$Old = 'C:\pilot\NSW-Fire-Coverage-1.0.0-x64.msi'
$New = 'C:\pilot\NSW-Fire-Coverage-1.1.0-x64.msi'
& $Runner -Phase fresh-current -Current $New -Evidence C:\pilot\evidence-fresh -DisposableMachine
if ($LASTEXITCODE -ne 0) { throw 'Fresh candidate pilot failed' }
```

Restore the clean VM snapshot; then run:

```powershell
& $Runner -Phase prepare -Previous $Old -Current $New -Evidence C:\pilot\evidence-upgrade -DisposableMachine
if ($LASTEXITCODE -ne 0) { throw 'Preparation failed' }
& $Runner -Phase upgrade -Evidence C:\pilot\evidence-upgrade -DisposableMachine
if ($LASTEXITCODE -ne 0) { throw 'Upgrade failed' }
# Save evidence/checkpoint first, then reboot the disposable machine:
Restart-Computer
# After boot: open elevated PowerShell, return to the checkout. Do not start the service manually.
.\Stand-alone\windows\tests\upgrade-smoke.ps1 -Phase verify-boot-uninstall -Evidence C:\pilot\evidence-upgrade -DisposableMachine
```

MSI verbose logs are written for each operation. Nonzero installer exit codes,
including reboot-required codes, stop the pilot rather than claiming success;
inspect the log and record/retest on a clean snapshot.

## Intel and Apple Silicon Macs

Run separately on each hardware architecture. From the checkout:

```sh
RUNNER=Stand-alone/macOS/tests/upgrade-smoke.sh
OLD=/Users/Shared/pilot/NSW-Fire-Coverage-1.0.0-macOS-Intel-AppleSilicon.pkg
NEW=/Users/Shared/pilot/NSW-Fire-Coverage-1.1.0-macOS-Intel-AppleSilicon.pkg
sudo sh "$RUNNER" --disposable-machine --phase fresh-current \
  --current "$NEW" --evidence /Users/Shared/pilot/evidence-fresh
```

Restore a clean snapshot; then run each command only after the previous succeeds:

```sh
sudo sh "$RUNNER" --disposable-machine --phase prepare --previous "$OLD" \
  --current "$NEW" --evidence /Users/Shared/pilot/evidence-upgrade
sudo sh "$RUNNER" --disposable-machine --phase upgrade \
  --evidence /Users/Shared/pilot/evidence-upgrade
sudo shutdown -r now
# After boot, return to the checkout. Do not bootstrap/kickstart the service.
sudo sh Stand-alone/macOS/tests/upgrade-smoke.sh --disposable-machine \
  --phase verify-boot-uninstall --evidence /Users/Shared/pilot/evidence-upgrade
```

Follow your organisation's policy for unsigned pilot packages; do not disable
Gatekeeper globally. Capture Installer/launchd errors on failure. The harness
checks the selected bundled Node architecture as well as launchd settings.

## What the harness proves (when run natively)

1. `fresh-current`: install the candidate on a clean system, reach HTTP health
   without manually starting the service, check service account and automatic
   start settings, then uninstall while retaining configuration/data.
2. `prepare`: fresh previous-release installation and automatic initial startup;
   stop it, set loopback/custom port/custom data directory and nondefault
   feed settings, then seed a valid saved GIS project with separate original
   Sources, edited Working GeoJSON, Exports/provenance and a dated cached feed.
   Restart the previous service to produce a real persisted RFS permit cache.
   Stop it and hash all fixture data and the exact configuration bytes.
3. `upgrade`: install the candidate, require a newer installed build manifest,
   check automatic install-time startup on the custom port, exact configuration
   and byte-for-byte retention, project visibility, working feature readability,
   cached feed visibility and permit cache readability through the real API.
   A clean restart closes SQLite and adds any generated SQLite index to
   the retention baseline (older GIS packages use GeoJSON without an index).
   Stage status is **passed-awaiting-reboot**, not full
   pilot success.
4. `verify-boot-uninstall`: require a changed OS boot identifier, check health
   without starting the service manually, read the saved project/feed again,
   uninstall and verify service removal, stopped HTTP endpoint, configuration
   and every inventoried data file retained. macOS also checks program removal.

The previous release predates GIS. The on-disk fixture therefore models data
already present in an administrator's workspace; it does not pretend 1.0.0
could import/edit GIS through its UI. Sources and Exports are retention fixtures,
not evidence of an import/export conversion journey. Existing runtime/GIS tests
cover that separate behaviour. Failed stages exit nonzero and leave local data
and evidence untouched for investigation. There is no automatic cleanup, repair
or rollback, and no automatic reboot.

## Evidence and administrator sign-off

For each target, archive `*-result.json`, `*-service.json`,
`*-installed-manifest.json`, MSI/Installer logs and `checkpoint.json` (hash
inventory, package identities, stage, boot identifier). Do not hand-edit the
checkpoint. A result is not a pass unless all four phase reports pass, the
upgrade checkpoint says `complete`, and the target OS/hardware matches the row.

Record in the rollout ticket:

| Field | Pilot evidence |
| --- | --- |
| Tester / date / authorised machine | Pending native pilot |
| OS edition, build, CPU, native runtime architecture | Pending |
| Previous / candidate version and SHA-256 | Pending |
| Fresh install/service/default port | Pending |
| Custom port, configuration hash, custom data path | Pending |
| Sources / Working / Exports / SQLite / feed / RFS hashes | Pending |
| Reboot auto-start and service identity | Pending |
| Uninstall, service absent, retained-data location | Pending |
| Evidence archive reference / approval / exceptions | Pending |

Before a real upgrade, stop the service and back up **both** `server.json` and
the entire resolved `dataDirectory` (including SQLite files, GIS trash, Sources,
Working, Exports and all caches); keep a copy outside the install/state paths.
Also retain the previous installer and checksums. Start the service again if
the upgrade is deferred. Never copy an actively edited SQLite workspace as a
consistent backup. Do not purge retained data/account after uninstall unless
the administrator has separately approved deletion and verified the backup.
If a pilot fails, preserve evidence and restore the disposable-machine snapshot;
do not “fix” the data to make the assertion pass.

## Checks available on Linux

```sh
node --test Stand-alone/tests/upgrade-support.test.mjs Stand-alone/tests/runtime.test.mjs
python3 Stand-alone/macOS/tests/package_test.py
```

The runtime/package checks require the existing built payloads under
`generated-artifacts/standalone` and `generated-artifacts/standalone-macos` and
MSI/XAR inspection tools. They verify fixture readability/restart retention,
hash assertions and package structure. They cannot verify Windows Installer,
SCM, macOS Installer, launchd, reboot or native filesystem permissions.

### Recorded Linux evidence — 2026-10-27

- Existing Windows payload/runtime/MSI inspection suite: **9 passed**.
- Upgrade inventory/fixture suite: **3 passed**, including real local HTTP
  reads of project/working feature/feed/permit cache across two process launches,
  mutation/deletion detection, symlink rejection and refusal to execute native
  installation on Linux.
- macOS package inspection suite: **10 passed**. Python emitted existing
  extraction-stream resource warnings; no assertion failed.
- Native harness JavaScript syntax, Mac wrapper shell syntax and Git whitespace
  checks: passed.
- Native PowerShell execution, Windows Installer/SCM, macOS Installer/launchd,
  hardware-native execution and reboot preservation: **NOT RUN**.

These results validate the portable test logic and existing package contents,
not the native pilot rows above. The native scripts themselves remain
unverified on their target operating systems.
