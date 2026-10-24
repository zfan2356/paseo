#!/usr/bin/env python3
"""Verify real Codex source switches using isolated credentials and a test thread."""
import argparse
import datetime
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import time
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--magpie", required=True, type=Path)
    parser.add_argument("--codex", required=True, type=Path)
    parser.add_argument("--codex-home", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--port", type=int, default=24825)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    gateway_home = output / "gateway-home"
    codex_home = output / "codex-home"
    workspace = output / "workspace"
    for folder in [gateway_home / ".config/magpie", codex_home, workspace]:
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copy2(args.codex_home / "auth.json", codex_home / "auth.json")
    (codex_home / "auth.json").chmod(0o600)
    shutil.copy2(args.codex_home / "gpt-models.json", codex_home / "gpt-models.json")
    provider_config = json.loads((Path.home() / ".config/magpie/providers.json").read_text())
    providers = [p for p in provider_config["providers"] if p.get("id") == "ichat"]
    if len(providers) != 1:
        raise RuntimeError("Expected exactly one configured iChat provider")
    group = next(g for g in provider_config["groups"] if g["id"] == "codex-unified")
    (gateway_home / ".config/magpie/providers.json").write_text(json.dumps({"providers": providers, "groups": [group]}))
    (gateway_home / ".config/magpie/providers.json").chmod(0o600)
    gateway_url = f"http://127.0.0.1:{args.port}"
    config = {
        "model": "gpt-6.1-sol",
        "model_provider": "openai",
        "openai_base_url": gateway_url + "/backend-api/codex",
        "model_catalog_json": str(codex_home / "gpt-models.json"),
        "model_context_window": 1_000_000,
        "model_auto_compact_token_limit": 700_000,
        "model_reasoning_effort": "high",
        "service_tier": "ultrafast",
        "approval_policy": "never",
        "sandbox_mode": "read-only",
    }
    (codex_home / "config.toml").write_text(
        "\n".join(f"{key} = {json.dumps(value)}" for key, value in config.items())
        + "\n[features]\nfast_mode = true\nultrafast_mode = true\n"
    )
    env = {
        **os.environ,
        "HOME": str(gateway_home),
        "USERPROFILE": str(gateway_home),
        "XDG_CONFIG_HOME": str(gateway_home / ".config"),
        "XDG_CACHE_HOME": str(gateway_home / ".cache"),
        "CODEX_HOME": str(codex_home),
        "MAGPIE_ADDR": f"127.0.0.1:{args.port}",
    }
    for key in ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "CODEX_API_BASE_URL"]:
        env.pop(key, None)
    logs = []
    processes = []
    report = {"startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "stages": []}
    try:
        gateway_log = (output / "gateway.log").open("w")
        logs.append(gateway_log)
        gateway = subprocess.Popen([str(args.magpie), "serve"], env=env, stdout=gateway_log, stderr=subprocess.STDOUT)
        processes.append(gateway)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if gateway.poll() is not None:
                raise RuntimeError("Isolated Magpie exited; inspect its private log")
            try:
                with opener.open(gateway_url + "/", timeout=1) as response:
                    if json.load(response).get("name") == "magpie":
                        break
            except OSError:
                time.sleep(0.2)
        else:
            raise TimeoutError("Isolated Magpie startup")
        codex_log = (output / "codex.log").open("w")
        logs.append(codex_log)
        client = subprocess.Popen(
            [str(args.codex), "app-server", "--listen", "stdio://"], env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=codex_log,
        )
        processes.append(client)
        buffer = bytearray()
        notes = []
        sequence = 0

        def send(method, params, request_id=None):
            message = {"method": method, "params": params}
            if request_id is not None:
                message["id"] = request_id
            client.stdin.write(json.dumps(message).encode() + b"\n")
            client.stdin.flush()

        def receive(timeout):
            deadline = time.monotonic() + timeout
            while b"\n" not in buffer:
                with selectors.DefaultSelector() as selector:
                    selector.register(client.stdout, selectors.EVENT_READ)
                    if not selector.select(max(0, deadline - time.monotonic())):
                        raise TimeoutError("Codex notification")
                chunk = os.read(client.stdout.fileno(), 65536)
                if not chunk:
                    raise RuntimeError("Isolated Codex exited")
                buffer.extend(chunk)
            line, _, remaining = buffer.partition(b"\n")
            buffer[:] = remaining
            message = json.loads(line)
            if "method" in message:
                notes.append(message)
                if "id" in message:
                    client.stdin.write(json.dumps({"id": message["id"], "error": {"code": -32601, "message": "No client-side tools in this check"}}).encode() + b"\n")
                    client.stdin.flush()
            return message

        def rpc(method, params):
            nonlocal sequence
            sequence += 1
            request_id = sequence
            send(method, params, request_id)
            while True:
                message = receive(120)
                if message.get("id") == request_id:
                    if "error" in message:
                        raise RuntimeError(f"{method}: {message['error']}")
                    return message["result"]

        rpc("initialize", {"clientInfo": {"name": "magpie_switch_check", "version": "1.0"}, "capabilities": {"experimentalApi": True}})
        send("initialized", {})
        thread = rpc("thread/start", {"cwd": str(workspace), "ephemeral": True, "model": "gpt-6.1-sol", "serviceTier": "ultrafast", "approvalPolicy": "never", "sandbox": "read-only"})
        thread_id = thread["thread"]["id"]
        report["threadId"] = thread_id
        token = "switch-" + uuid.uuid4().hex
        token_file = workspace / "switch-token.txt"
        token_file.write_text(token + "\n")

        def turn(label, model, prompt, expect_token=False, expect_tool=False):
            before = len(notes)
            started = time.monotonic()
            result = rpc("turn/start", {"threadId": thread_id, "model": model, "serviceTier": "ultrafast", "input": [{"type": "text", "text": prompt}]})
            turn_id = result["turn"]["id"]
            while True:
                message = receive(180)
                if message.get("method") == "turn/completed" and message["params"]["turn"]["id"] == turn_id:
                    completed = message["params"]["turn"]
                    break
            new_notes = notes[before:]
            messages = []
            tools = 0
            for note in new_notes:
                if note.get("method") == "item/completed":
                    item = note.get("params", {}).get("item", {})
                    if item.get("type") == "agentMessage":
                        messages.append(item.get("text", ""))
                    if item.get("type") == "commandExecution":
                        tools += 1
            text = "\n".join(messages)
            stage = {"label": label, "model": model, "status": completed.get("status"), "seconds": round(time.monotonic() - started, 2), "toolCalls": tools, "rememberedToken": token in text if expect_token else None}
            report["stages"].append(stage)
            (output / "verification.json").write_text(json.dumps(report, indent=2))
            print(json.dumps(stage), flush=True)
            if completed.get("status") != "completed":
                raise RuntimeError(f"{label}: turn failed; private error: {completed.get('error')}")
            if expect_token and token not in text:
                raise AssertionError(f"{label}: lost the earlier tool result")
            if expect_tool and tools != 1:
                raise AssertionError(f"{label}: expected exactly one terminal execution")
            if expect_token and tools:
                raise AssertionError(f"{label}: fetched the token again instead of retaining context")

        turn("subscription-read-tool", "gpt-6.1-sol", "Read ./switch-token.txt using exactly one terminal command: cat ./switch-token.txt. Remember the token for later turns. Reply only READY, without repeating the token.", expect_tool=True)
        token_file.unlink()
        if args.compact:
            rpc("thread/compact/start", {"threadId": thread_id})
            while True:
                note = receive(180)
                if note.get("method") == "thread/compacted":
                    break
                if note.get("method") == "item/completed" and note.get("params", {}).get("item", {}).get("type") == "contextCompaction":
                    break
            report["compacted"] = True
        prompt = "Reply with exactly the token you read earlier. Do not call any tools."
        for index in range(5):
            turn(f"ichat-{index + 1}", "ichat/gpt-6.1-sol", prompt, expect_token=True)
        turn("subscription-return", "gpt-6.1-sol", prompt, expect_token=True)
        turn("subscription-followup", "gpt-6.1-sol", prompt, expect_token=True)
        turn("unified", "group/codex-unified", prompt, expect_token=True)
        turn("ichat-return", "ichat/gpt-6.1-sol", prompt, expect_token=True)
        turn("subscription-final", "gpt-6.1-sol", prompt, expect_token=True)
        rows = []
        usage_file = gateway_home / ".config/magpie/usage.jsonl"
        for line in usage_file.read_text().splitlines():
            row = json.loads(line)
            if row.get("session") == thread_id or row.get("native_session") == thread_id:
                rows.append({key: row.get(key) for key in ["req", "provider", "model", "status", "tier_asked", "tier_sent", "tier_served"]})
        if not any(row["provider"] == "ichat" for row in rows):
            raise AssertionError("No actual iChat request was recorded")
        report.update(ok=True, routes=rows)
        (output / "verification.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"ok": True, "output": str(output), "routes": rows}), flush=True)
    finally:
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for log in logs:
            log.close()


if __name__ == "__main__":
    main()
