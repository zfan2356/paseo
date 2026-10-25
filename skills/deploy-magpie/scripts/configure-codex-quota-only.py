#!/usr/bin/env python3
"""Enable subscription-first routing without changing credentials or other groups."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time


def prepare(config, model_cache):
    result = copy.deepcopy(config)
    models = {m["ID"]: m for m in model_cache["models"]}
    groups = []
    windows = {}
    for group in result.get("groups", []):
        members = group.get("members", [])
        if len(members) != 2 or not members[0].startswith("codex/gpt-6"):
            continue
        model = members[0].split("/", 1)[1]
        if members[1] != "ichat/" + model:
            continue
        if group.get("routing") != "order" or any(group.get(k) for k in ["rules", "match", "sink", "firstToken", "effort"]):
            raise ValueError("Codex Unified group has custom routing; inspect before changing it")
        known = models[model]
        window = max(known.get("Context", 0), known.get("MaxContext", 0))
        if window <= 0:
            raise ValueError("The native catalog has no known window for " + model)
        windows[model] = window
        group.update(quotaOnly=True, affinity="off")
        groups.append(group["id"])
    if not groups:
        raise ValueError("No ordered Codex/iChat Unified pairs found")
    provider = next((p for p in result["providers"] if p["id"] == "codex"), None)
    if provider is None:
        provider = {"id": "codex"}
        result["providers"].append(provider)
    if any(provider.get(k) for k in ["chat", "responses", "anthropic", "off", "hidden", "noModels"]):
        raise ValueError("Codex provider is overridden or disabled; inspect before changing it")
    contexts = provider.setdefault("contexts", {})
    for model, window in windows.items():
        if model in contexts and contexts[model] != window:
            raise ValueError("Existing per-model context differs for " + model)
        contexts[model] = window
    return result, {"groups": groups, "contexts": windows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path.home() / ".config/magpie/providers.json")
    parser.add_argument("--models", type=Path, default=Path.home() / ".cache/magpie/models/codex.json")
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    original = args.config.read_bytes()
    updated, report = prepare(json.loads(original), json.loads(args.models.read_bytes()))
    report["applied"] = False
    if args.apply:
        if args.backup_dir is None:
            parser.error("--apply requires --backup-dir")
        os.umask(0o077)
        args.backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup = args.backup_dir / ("providers-" + str(time.time_ns()) + ".json")
        with backup.open("xb") as stream:
            stream.write(original)
        if args.config.read_bytes() != original:
            raise RuntimeError("Configuration changed during preparation; nothing was applied")
        fd, temporary = tempfile.mkstemp(prefix=".quota-only-", dir=args.config.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(updated, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, args.config)
        finally:
            if Path(temporary).exists():
                Path(temporary).unlink()
        report.update(applied=True, backup=str(backup), beforeSha256=hashlib.sha256(original).hexdigest())
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
