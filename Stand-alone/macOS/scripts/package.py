"""Create a standard unsigned flat distribution PKG using xar, cpio, and BOM.

This is a cross-build helper, not a replacement for native macOS pilot testing.
"""
import gzip
import hashlib
import html
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request

root, source, output, version = map(str, sys.argv[1:])
root, source, output = Path(root), Path(source), Path(output)
work = output / "package-work"
shutil.rmtree(work, ignore_errors=True)
component = work / "NSWFireCoverage.pkg"
resources = work / "Resources" / "en.lproj"
scripts = output / "package-scripts"
component.mkdir(parents=True)
resources.mkdir(parents=True)
scripts.mkdir(parents=True, exist_ok=True)


def archive(directory, destination):
    members = [Path(".")] + sorted(directory.rglob("*"))
    names = [str(p if p == Path(".") else p.relative_to(directory)) for p in members]
    process = subprocess.Popen(
        ["cpio", "--null", "--create", "--format=odc", "--owner=0:0"],
        cwd=directory, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    process.stdin.write(b"\0".join(name.encode() for name in names) + b"\0")
    process.stdin.close()
    with destination.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
        shutil.copyfileobj(process.stdout, compressed)
    error = process.stderr.read().decode()
    if process.wait() != 0:
        raise RuntimeError(error)


for name in ("preinstall", "postinstall"):
    shutil.copyfile(source / "installer" / name, scripts / name)
    (scripts / name).chmod(0o755)

archive(root, component / "Payload")
archive(scripts, component / "Scripts")
def prepare_mkbom():
    # The distro's legacy 0.2 writer aborts under modern fortified libc, even
    # for a single text file. Build the pinned fixed upstream writer instead;
    # do not disable compiler hardening or omit the package's BOM.
    tool = json.loads((source / "dependencies.lock.json").read_text())["buildBomutils"]
    directory = output / "build-tools"
    directory.mkdir(parents=True, exist_ok=True)
    cached = directory / "bomutils.tar.gz"
    if not cached.exists():
        request = urllib.request.Request(tool["url"], headers={"User-Agent": "NSW-Fire-Coverage-Builder"})
        with urllib.request.urlopen(request, timeout=60) as response:
            cached.write_bytes(response.read())
    data = cached.read_bytes()
    if hashlib.sha256(data).hexdigest() != tool["sha256"]:
        raise RuntimeError("BOM build-tool checksum mismatch. Do not bypass verification.")
    files = ["mkbom.cpp", "crc32.cpp", "crc32.hpp", "crc32_poly.hpp", "printnode.cpp", "printnode.hpp", "bom.h"]
    tool_source = directory / "pinned-source"
    tool_source.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for name in files:
            member = archive.extractfile("bomutils-" + tool["revision"] + "/src/" + name)
            (tool_source / name).write_bytes(member.read())
    binary = directory / "mkbom"
    subprocess.run([
        "g++", "-O2", "-std=c++11",
        str(tool_source / "mkbom.cpp"), str(tool_source / "crc32.cpp"),
        str(tool_source / "printnode.cpp"), "-o", str(binary),
    ], check=True)
    return binary


subprocess.run([str(prepare_mkbom()), "-u", "0", "-g", "0", str(root), str(component / "Bom")], check=True)
files = [p for p in root.rglob("*") if p.is_file()]
kbytes = (sum(p.stat().st_size for p in files) + 1023) // 1024
identifier = "au.nswfirecoverage.standalone.macos"
(component / "PackageInfo").write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<pkg-info format-version="2" identifier="{identifier}" version="{version}"
  install-location="/" auth="root" relocatable="false" overwrite-permissions="false">
  <payload installKBytes="{kbytes}" numberOfFiles="{len(files)}"/>
  <scripts><preinstall file="./preinstall"/><postinstall file="./postinstall"/></scripts>
</pkg-info>
''')
(work / "Distribution").write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>NSW Fire Coverage</title>
  <welcome file="Welcome.html" mime-type="text/html"/>
  <readme file="ReadMe.html" mime-type="text/html"/>
  <options customize="never" require-scripts="true" hostArchitectures="x86_64,arm64"/>
  <domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>
  <volume-check><allowed-os-versions><os-version min="11.0"/></allowed-os-versions></volume-check>
  <choices-outline><line choice="default"><line choice="{identifier}"/></line></choices-outline>
  <choice id="default"/>
  <choice id="{identifier}" visible="false"><pkg-ref id="{identifier}"/></choice>
  <pkg-ref id="{identifier}" version="{version}" installKBytes="{kbytes}" auth="Root" onConclusion="none">#NSWFireCoverage.pkg</pkg-ref>
</installer-gui-script>
''')
style = "<style>body{font:14px/1.5 -apple-system,Helvetica,sans-serif;padding:16px;color:#26342e}pre{white-space:pre-wrap;font:12px/1.5 monospace}</style>"
(resources / "Welcome.html").write_text(
    "<!doctype html><html><meta charset='utf-8'>" + style
    + "<h1>NSW Fire Coverage</h1><p>Self-hosted for Intel and Apple Silicon Macs running macOS 11 or later.</p>"
    + "<p>Installs a local background service and bundled native runtimes. No Node installation, Rosetta, Replit account or Replit server is required.</p>"
    + "<p>Default address: <strong>http://localhost:5400/</strong></p>"
    + "<p>Live official NSW data services require internet access. Data and results remain indicative; in an emergency call 000.</p>"
    + "<p>This package is unsigned and has not been native-installation-tested in the Linux build environment. Pilot before wider rollout.</p></html>"
)
(resources / "ReadMe.html").write_text(
    "<!doctype html><html><meta charset='utf-8'>" + style
    + "<pre>" + html.escape((source / "README.md").read_text()) + "</pre></html>"
)
filename = output / f"NSW-Fire-Coverage-{version}-macOS-Intel-AppleSilicon.pkg"
subprocess.run([
    "xar", "-c", "-f", str(filename), "--compression=none",
    "Distribution", "Resources", "NSWFireCoverage.pkg",
], cwd=work, check=True)
print(json.dumps({"package": str(filename), "files": len(files), "installKBytes": kbytes}))
