# Codex subagent defaults

Status: active

## Original requirement

Use Codex configuration as the source of subagent model and reasoning defaults,
including children created through Paseo. Keeping model names in AGENTS.md
caused Paseo children to keep using an older model after config.toml changed.

## Design

Agent-scoped `create_agent` accepts an omitted provider/model. The caller's
provider session resolves subagent defaults at creation time. Codex uses its
existing app-server connection and `config/read` with the caller's cwd, so the
effective CODEX_HOME, profiles, and workspace configuration stay provider-owned.

The Codex adapter reads `[agents].default_subagent_model` and
`default_subagent_reasoning_effort`. Unset values inherit the parent's effective
selection. Explicit model and effort arguments override their respective
defaults. A different provider or a detached root does not inherit these values.
Providers without a defaults adapter still require an explicit provider/model.
Top-level creation keeps its required provider/model argument.

Reads are uncached. A configuration error fails creation before starting a child;
it does not silently choose another model. This changes future creation only:
existing children retain their settings. Native Codex subagents continue using
Codex's own configuration handling.

## Validation

The MCP creation regression covers default selection, configuration changes,
independent overrides, cross-provider isolation, and configuration failures.
The Codex adapter regression covers cwd-aware reads, updates, unset defaults,
and propagation of config/read errors.

The server change requires a daemon deployment. Reloading a conversation alone
does not replace the running daemon's tool implementation.

## Cross-harness input compatibility

The shared `create_agent` MCP tool accepts `settings.features: null` from
clients that serialize an unset optional field as null and normalizes it to an
omitted feature override. Non-object feature values remain invalid. The tool
description directs Claude Code and other MCP clients to use Paseo
`create_agent` for cross-harness children and to omit feature overrides when
they are unnecessary.

The compatibility regression lives in
`packages/server/src/server/agent/mcp-server.test.ts` under the
`create_agent MCP tool` suite.
