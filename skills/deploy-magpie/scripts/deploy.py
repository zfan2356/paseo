#!/usr/bin/env python3
"""Install the repository's pinned Magpie CLI without changing running services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--install", action="store_true")
    parser.add_argument("--with-middleware", action="store_true")
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="Paseo checkout root")
    args = parser.parse_args()
    root = args.repo.resolve()
    source = root / "third_party/magpie"
    lock = json.loads((root / "third_party/magpie.lock.json").read_text())
    revision = run("git", "-C", str(source), "rev-parse", "HEAD", capture_output=True).stdout.strip()
    dirty = run("git", "-C", str(source), "status", "--porcelain", capture_output=True).stdout
    if revision != lock["revision"] or dirty:
        raise SystemExit("Magpie source must be clean and match third_party/magpie.lock.json")
    patches = []
    for entry in lock.get("patches", []):
        patch_file = (root / entry["path"]).resolve()
        if not patch_file.is_relative_to(root) or hashlib.sha256(patch_file.read_bytes()).hexdigest() != entry["sha256"]:
            raise SystemExit("Magpie patch must match third_party/magpie.lock.json: " + entry["path"])
        patches.append(patch_file)
    if patches:
        run("git", "-C", str(source), "apply", "--check", *map(str, patches))
    if not shutil.which("go") and not args.dry_run:
        raise SystemExit("Install Go (the pinned source requires " + lock["go"] + ")")
    print("Verified Magpie source " + revision)
    if args.check:
        return
    home = Path.home()
    bindir = home / ".local/bin"
    patch_identity = hashlib.sha256(json.dumps(lock.get("patches", []), sort_keys=True).encode()).hexdigest()[:12]
    release_id = revision + "-" + patch_identity if patches else revision
    release = home / ".local/lib/magpie" / release_id
    print("Build " + lock["version"] + "; install under " + str(release))
    print("Existing services, provider accounts and routes are preserved.")
    if args.dry_run:
        if args.with_middleware:
            print("Register personal-speed.middleware.js, preserving its current options")
        return
    bindir.mkdir(parents=True, exist_ok=True)
    release.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="magpie-build-") as temporary:
        binary = Path(temporary) / "magpie"
        build_source = source
        if patches:
            archive_file = Path(temporary) / "source.tar"
            with archive_file.open("wb") as output:
                run("git", "-C", str(source), "archive", "HEAD", stdout=output)
            build_source = Path(temporary) / "source"
            build_source.mkdir()
            with tarfile.open(archive_file) as archive:
                archive.extractall(build_source, filter="data")
            run("git", "-C", str(build_source), "apply", *map(str, patches))
        env = {**os.environ, "CGO_ENABLED": "0"}
        run("go", "build", "-tags", "nogui", "-trimpath", "-ldflags",
            "-s -w -X main.version=" + lock["version"], "-o", str(binary), ".", cwd=build_source, env=env)
        version = run(str(binary), "--version", capture_output=True).stdout.strip()
        if lock["version"] not in version:
            raise SystemExit("Built binary version does not match the lock")
        record = {**lock, "sha256": hashlib.sha256(binary.read_bytes()).hexdigest()}
        installed = bindir / "magpie"
        if installed.exists():
            backups = release.parent / "backups"
            backups.mkdir(exist_ok=True)
            backup = backups / (time.strftime("%Y%m%d-%H%M%S") + "-" + str(time.time_ns()) + "-magpie")
            shutil.copy2(installed, backup, follow_symlinks=True)
            print("Previous binary: " + str(backup))
        staged_binary = release / "magpie.new"
        shutil.copy2(binary, staged_binary)
        staged_binary.chmod(0o755)
        os.replace(staged_binary, release / "magpie")
        (release / "build.json").write_text(json.dumps(record, indent=2) + "\n")
    staged_link = bindir / (".magpie-" + str(os.getpid()))
    try:
        staged_link.symlink_to(release / "magpie")
        os.replace(staged_link, installed)
    finally:
        staged_link.unlink(missing_ok=True)
    starter = bindir / (".magpie-start-" + str(os.getpid()))
    try:
        shutil.copy2(Path(__file__).with_name("magpie-start.py"), starter)
        starter.chmod(0o755)
        os.replace(starter, bindir / "magpie-start")
    finally:
        starter.unlink(missing_ok=True)
    if args.with_middleware:
        plugin_config = home / ".config/magpie/plugins.json"
        entries = json.loads(plugin_config.read_text()).get("plugins", []) if plugin_config.exists() else []
        existing = [entry for entry in entries if Path(entry.get("spec", "")).name == "personal-speed.middleware.js"]
        if existing:
            print("Retained the existing personal speed middleware and its options; migrate its path separately if needed.")
        else:
            run(str(installed), "plugin", "add", str(root / "plugins/magpie/server/personal-speed.middleware.js"))
    print("Installed " + version + ". Run magpie-start when ready; no process was restarted.")


if __name__ == "__main__":
    main()
