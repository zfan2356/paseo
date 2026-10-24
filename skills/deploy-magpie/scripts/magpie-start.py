#!/usr/bin/env python3
"""Start a user-owned Magpie CLI bound to loopback; keep its key private."""
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request


def healthy():
    try:
        # Magpie exposes its identity at GET /, not /health. Loopback probes
        # must not follow the user's HTTP proxy configuration.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:3425/", timeout=2) as response:
            info = json.load(response)
            return response.status == 200 and isinstance(info, dict) and info.get("name") == "magpie"
    except (OSError, urllib.error.URLError, ValueError):
        return False


def launch_environment():
    env = dict(os.environ)
    config_path = Path.home() / ".config/magpie/runtime.json"
    if config_path.exists():
        config = json.loads(config_path.read_text())
        if not isinstance(config, dict) or set(config) - {"codexHome"}:
            raise SystemExit("Invalid Magpie runtime.json; only codexHome is supported.")
        codex_home = config.get("codexHome")
        if not isinstance(codex_home, str) or not Path(codex_home).is_absolute() or not Path(codex_home).is_dir():
            raise SystemExit("Magpie codexHome must name an existing absolute directory.")
        env["CODEX_HOME"] = codex_home
    return env


def main():
    os.umask(0o077)
    state = Path.home() / ".local/state/magpie"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    with (state / "start.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if healthy():
            print("Magpie is already healthy on 127.0.0.1:3425; left it running.")
            return
        key_path = state / "web-key"
        if not key_path.exists():
            with key_path.open("x") as key_file:
                key_file.write(secrets.token_urlsafe(32) + "\n")
        key_path.chmod(0o600)
        key = key_path.read_text().strip()
        if len(key) < 16 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~-" for c in key):
            raise SystemExit("Invalid web-key format; preserve the file and inspect it locally.")
        env = {**launch_environment(), "MAGPIE_ADDR": "127.0.0.1:3425", "MAGPIE_WEB_KEY": key, "DO_NOT_TRACK": "1"}
        with (state / "serve.log").open("ab") as output:
            process = subprocess.Popen([str(Path.home() / ".local/bin/magpie"), "serve", "--web=127.0.0.1:3430"],
                                       stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                       env=env, start_new_session=True)
        for _ in range(30):
            if process.poll() is not None:
                raise SystemExit("Magpie exited. Inspect ~/.local/state/magpie/serve.log locally.")
            if healthy():
                (state / "serve.pid").write_text(str(process.pid) + "\n")
                print("Magpie is healthy; management listens on 127.0.0.1:3430.")
                return
            time.sleep(1)
        process.terminate()
        raise SystemExit("Magpie did not become healthy in 30 seconds. Inspect serve.log locally.")


if __name__ == "__main__":
    main()
