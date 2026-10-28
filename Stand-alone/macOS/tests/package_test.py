"""Inspect the real packaged payload without executing macOS-only code."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "Stand-alone/macOS"
OUTPUT = ROOT / "generated-artifacts/standalone-macos"
PACKAGE = OUTPUT / f"NSW-Fire-Coverage-{os.environ.get('INSTALLER_VERSION', '1.2.0')}-macOS-Intel-AppleSilicon.pkg"
APP_REL = Path("Library/Application Support/NSW Fire Coverage")


class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="nsw-macos-package-")
        cls.expanded = Path(cls.temporary.name) / "expanded"
        cls.expanded.mkdir()
        subprocess.run(["xar", "-x", "-f", str(PACKAGE)], cwd=cls.expanded, check=True, capture_output=True)
        cls.component = cls.expanded / "NSWFireCoverage.pkg"
        cls.payload = Path(cls.temporary.name) / "payload"
        cls.payload.mkdir()
        # The test extracts only the package that this repository just built.
        with gzip.open(cls.component / "Payload", "rb") as stream:
            extraction = subprocess.Popen(
                ["cpio", "-idmu", "--no-absolute-filenames", "--no-preserve-owner"],
                cwd=cls.payload, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            shutil.copyfileobj(stream, extraction.stdin)
            extraction.stdin.close()
            error = extraction.stderr.read().decode()
            if extraction.wait() != 0:
                raise RuntimeError(error)
        cls.app = cls.payload / APP_REL
        cls.manifest = json.loads((cls.app / "BUILD-MANIFEST.json").read_text())

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_01_distribution_supports_native_intel_and_arm64_without_rosetta(self):
        distribution = ET.parse(self.expanded / "Distribution").getroot()
        self.assertEqual(distribution.find("options").get("hostArchitectures"), "x86_64,arm64")
        self.assertEqual(distribution.find("./volume-check/allowed-os-versions/os-version").get("min"), "11.0")
        reference = distribution.findall("pkg-ref")[-1]
        self.assertEqual(reference.text, "#NSWFireCoverage.pkg")
        self.assertTrue((self.component / "Bom").is_file())
        self.assertTrue((self.component / "Scripts").is_file())

    def test_02_both_native_binaries_and_their_minimum_os_are_correct(self):
        for arch, cpu in [("x64", 0x01000007), ("arm64", 0x0100000C)]:
            binary = self.app / f"runtime/darwin-{arch}/node"
            content = binary.read_bytes()
            self.assertEqual(struct.unpack_from("<I", content)[0], 0xFEEDFACF)
            self.assertEqual(struct.unpack_from("<I", content, 4)[0], cpu)
            offset, minimum = 32, None
            for _ in range(struct.unpack_from("<I", content, 16)[0]):
                command, size = struct.unpack_from("<II", content, offset)
                if command in (0x24, 0x32):
                    value = struct.unpack_from("<I", content, offset + (12 if command == 0x32 else 8))[0]
                    minimum = (value >> 16, (value >> 8) & 255, value & 255)
                offset += size
            self.assertIsNotNone(minimum)
            self.assertLessEqual(minimum, (11, 0, 0))
            self.assertEqual(binary.stat().st_mode & 0o777, 0o755)

    def test_03_defaults_and_browser_link_are_5400_not_8080(self):
        config = json.loads((self.app / "config/server.default.json").read_text())
        self.assertEqual(config["port"], 5400)
        self.assertEqual(config["host"], "0.0.0.0")
        link = plistlib.loads((self.payload / "Applications/NSW Fire Coverage.webloc").read_bytes())
        self.assertEqual(link["URL"], "http://localhost:5400/")
        self.assertEqual(self.manifest["defaultPort"], 5400)

    def test_04_launchd_uses_a_restricted_account_and_local_program(self):
        plist = plistlib.loads((self.payload / "Library/LaunchDaemons/au.nswfirecoverage.standalone.plist").read_bytes())
        self.assertEqual(plist["UserName"], "_nswfirecoverage")
        self.assertEqual(plist["GroupName"], "_nswfirecoverage")
        self.assertTrue(plist["RunAtLoad"])
        self.assertTrue(plist["KeepAlive"])
        self.assertEqual(plist["ProgramArguments"], ["/Library/Application Support/NSW Fire Coverage/bin/start-server.sh"])
        self.assertTrue(plist["StandardOutPath"].startswith("/Library/Application Support/NSW Fire Coverage Data/"))
        self.assertEqual(plist["ThrottleInterval"], 30)

    def test_05_extracted_files_match_every_manifest_hash_and_mode(self):
        for record in self.manifest["files"]:
            file = self.payload / record["path"]
            self.assertTrue(file.is_file(), record["path"])
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(), record["sha256"], record["path"])
            self.assertEqual(file.stat().st_mode & 0o777, record["mode"], record["path"])
        receipt = ET.parse(self.component / "PackageInfo").getroot()
        self.assertEqual(receipt.get("identifier"), "au.nswfirecoverage.standalone.macos")
        self.assertEqual(int(receipt.find("payload").get("numberOfFiles")), len(self.manifest["files"]) + 1)

    def test_06_installer_and_operator_scripts_have_valid_posix_shell_syntax(self):
        paths = list(SOURCE.rglob("*.sh")) + [SOURCE / "installer/preinstall", SOURCE / "installer/postinstall"]
        for file in paths:
            subprocess.run(["sh", "-n", str(file)], check=True)
        post = (SOURCE / "installer/postinstall").read_text()
        self.assertIn("launchctl bootstrap", post)
        self.assertIn('if [ ! -e "$STATE/server.json" ]', post)
        self.assertIn('UserShell /usr/bin/false', post)
        self.assertIn('IsHidden 1', post)
        uninstall = (SOURCE / "operator/uninstall.sh").read_text()
        self.assertNotIn('rm -rf "$STATE"', uninstall)
        self.assertNotIn('dscl', uninstall)

    def test_07_no_replit_development_or_remote_font_requests_are_packaged(self):
        import re
        forbidden = re.compile(r"https?://[^\"'\s<>]*(?:replit\.(?:com|app|dev)|repl\.co)|/@vite/client|fonts\.googleapis\.com|fonts\.gstatic\.com")
        for record in self.manifest["files"]:
            file = self.payload / record["path"]
            if file.suffix in (".js", ".mjs", ".css", ".html", ".sh", ".plist", ".json", ".webloc"):
                self.assertIsNone(forbidden.search(file.read_text()), record["path"])
        self.assertFalse(list(self.payload.rglob("*.exe")))
        self.assertFalse(list(self.payload.rglob("NSWFireCoverage.xml")))

    def test_08_receipt_bom_lists_both_native_runtimes(self):
        listing = subprocess.check_output(["lsbom", "-f", str(self.component / "Bom")], text=True)
        self.assertIn("runtime/darwin-x64/node", listing)
        self.assertIn("runtime/darwin-arm64/node", listing)

    def test_09_launcher_selects_native_architecture_and_preserves_arguments(self):
        # Exercise the real shell dispatcher with controlled sysctl/uname/node
        # stubs; real Mach-O executables cannot run in this Linux build host.
        launcher = (SOURCE / "bin/start-server.sh").read_text()
        for arch in ("x64", "arm64"):
            with tempfile.TemporaryDirectory(prefix="nsw-dispatch-test-") as name:
                temp = Path(name)
                runtime = temp / f"runtime/darwin-{arch}"
                runtime.mkdir(parents=True)
                node = runtime / "node"
                node.write_text("#!/bin/sh\nprintf '%s\\n' \"$0\" \"$@\"\n")
                node.chmod(0o755)
                script = launcher.replace("APP='/Library/Application Support/NSW Fire Coverage'", f"APP='{temp}'")
                script = script.replace("/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0", f"printf {1 if arch == 'arm64' else 0}")
                script = script.replace("/usr/bin/uname -m", "printf x86_64")
                output = subprocess.check_output(["sh", "-c", script, "launcher", "--refresh-rfs"], text=True)
                self.assertIn(f"runtime/darwin-{arch}/node", output)
                self.assertIn("--refresh-rfs", output)
                self.assertIn("/Library/Application Support/NSW Fire Coverage Data/server.json", output)

    def test_10_package_checksum_matches_the_download(self):
        expected = Path(str(PACKAGE) + ".sha256").read_text().split()[0]
        self.assertEqual(hashlib.sha256(PACKAGE.read_bytes()).hexdigest(), expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
