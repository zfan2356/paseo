"""Exercise deployment boundaries with a temporary checkout and build adapter."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).with_name("deploy.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

quota_spec = importlib.util.spec_from_file_location("quota", Path(__file__).with_name("configure-codex-quota-only.py"))
quota = importlib.util.module_from_spec(quota_spec)
quota_spec.loader.exec_module(quota)


class QuotaConfigurationTest(unittest.TestCase):
    def test_preserves_credentials_other_groups_and_client_window(self):
        original = {"providers": [{"id": "ichat", "key": "private-fixture"}], "groups": [
            {"id": "codex-unified", "members": ["codex/gpt-6.1-sol", "ichat/gpt-6.1-sol"], "routing": "order", "affinity": "session", "context": 1000000},
            {"id": "other", "members": ["a/m", "b/m"], "routing": "rotate"},
        ]}
        models = {"models": [{"ID": "gpt-6.1-sol", "Context": 500000, "MaxContext": 872000}]}
        updated, report = quota.prepare(original, models)
        self.assertEqual(updated["providers"][0], original["providers"][0])
        self.assertEqual(updated["groups"][1], original["groups"][1])
        self.assertEqual(updated["groups"][0]["context"], 1000000)
        self.assertEqual(updated["groups"][0]["affinity"], "off")
        self.assertTrue(updated["groups"][0]["quotaOnly"])
        self.assertEqual(report["contexts"], {"gpt-6.1-sol": 872000})
        self.assertNotIn("quotaOnly", original["groups"][0])
        self.assertEqual(quota.prepare(updated, models)[0], updated)

    def test_refuses_to_replace_an_explicit_model_window(self):
        original = {"providers": [{"id": "codex", "contexts": {"gpt-6.1-sol": 1000000}}], "groups": [
            {"id": "g", "members": ["codex/gpt-6.1-sol", "ichat/gpt-6.1-sol"], "routing": "order"},
        ]}
        with self.assertRaises(ValueError):
            quota.prepare(original, {"models": [{"ID": "gpt-6.1-sol", "Context": 500000, "MaxContext": 872000}]})


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="magpie-deployment-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "checkout"
        self.home = Path(self.temp.name) / "user"
        self.source = self.root / "third_party/magpie"
        self.source.mkdir(parents=True)
        self.home.mkdir()
        self.git("init", "-q")
        (self.source / "source.txt").write_text("pinned source\n")
        self.git("add", "source.txt")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture")
        self.revision = self.git("rev-parse", "HEAD").stdout.strip()
        self.lock = {"revision": self.revision, "version": "0.1.0-test", "go": "1.26.8"}
        (self.root / "third_party/magpie.lock.json").write_text(json.dumps(self.lock))
        self.binary = self.home / ".local/bin/magpie"
        self.binary.parent.mkdir(parents=True)
        self.binary.write_text("old binary")
        self.config = self.home / ".config/magpie/accounts.json"
        self.config.parent.mkdir(parents=True)
        self.config.write_text("private fixture must remain unchanged")
        self.build_inputs = []

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.source), *args], check=True, text=True, capture_output=True)

    def invoke(self, *args, fail_build=False):
        real_run = deploy.run

        def run(*command, **kwargs):
            if command[0] != "go":
                return real_run(*command, **kwargs)
            if fail_build:
                raise subprocess.CalledProcessError(1, command)
            self.build_inputs.append((Path(kwargs["cwd"]) / "source.txt").read_text())
            output = Path(command[command.index("-o") + 1])
            output.write_text("#!/bin/sh\necho 'magpie 0.1.0-test'\n")
            output.chmod(0o755)

        with patch.object(deploy.Path, "home", return_value=self.home), \
             patch.object(deploy.shutil, "which", return_value="/fixture/go"), \
             patch.object(deploy, "run", side_effect=run), \
             patch("sys.argv", ["deploy.py", "--repo", str(self.root), *args]), \
             contextlib.redirect_stdout(io.StringIO()):
            deploy.main()

    def test_install_preserves_config_and_previous_binary_even_on_same_pin(self):
        self.invoke("--install")
        self.assertTrue(self.binary.is_symlink())
        self.assertEqual(self.config.read_text(), "private fixture must remain unchanged")
        backups = self.home / ".local/lib/magpie/backups"
        self.assertEqual([p.read_text() for p in backups.iterdir()], ["old binary"])
        self.binary.resolve().write_text("previous build at same pin")
        self.invoke("--install")
        self.assertIn("previous build at same pin", [p.read_text() for p in backups.iterdir()])
        self.assertEqual(self.config.read_text(), "private fixture must remain unchanged")

    def test_failed_build_keeps_installed_binary(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke("--install", fail_build=True)
        self.assertFalse(self.binary.is_symlink())
        self.assertEqual(self.binary.read_text(), "old binary")

    def test_dry_run_and_dirty_source_do_not_mutate_install(self):
        before = sorted(str(p.relative_to(self.home)) for p in self.home.rglob("*"))
        self.invoke("--dry-run")
        self.assertEqual(sorted(str(p.relative_to(self.home)) for p in self.home.rglob("*")), before)
        (self.source / "source.txt").write_text("unreviewed change")
        with self.assertRaises(SystemExit):
            self.invoke("--install")
        self.assertEqual(self.binary.read_text(), "old binary")

    def add_patch(self):
        patch_file = self.root / "patches/magpie/context.patch"
        patch_file.parent.mkdir(parents=True)
        patch_file.write_text(
            "diff --git a/source.txt b/source.txt\n"
            "--- a/source.txt\n+++ b/source.txt\n"
            "@@ -1 +1 @@\n-pinned source\n+patched source\n"
        )
        self.lock["patches"] = [{
            "path": "patches/magpie/context.patch",
            "sha256": hashlib.sha256(patch_file.read_bytes()).hexdigest(),
        }]
        (self.root / "third_party/magpie.lock.json").write_text(json.dumps(self.lock))
        return patch_file

    def test_patch_is_verified_and_built_without_editing_submodule(self):
        self.add_patch()
        self.invoke("--dry-run")
        self.assertEqual((self.source / "source.txt").read_text(), "pinned source\n")
        self.assertEqual(self.git("status", "--porcelain").stdout, "")
        self.invoke("--install")
        self.assertEqual(self.build_inputs, ["patched source\n"])
        self.assertEqual((self.source / "source.txt").read_text(), "pinned source\n")
        manifest = json.loads((self.binary.resolve().parent / "build.json").read_text())
        self.assertEqual(manifest["patches"], self.lock["patches"])

    def test_changed_patch_is_rejected_before_build_or_install(self):
        patch_file = self.add_patch()
        patch_file.write_text(patch_file.read_text().replace("patched source", "unreviewed source"))
        with self.assertRaises(SystemExit):
            self.invoke("--install")
        self.assertEqual(self.build_inputs, [])
        self.assertEqual(self.binary.read_text(), "old binary")


if __name__ == "__main__":
    unittest.main()
