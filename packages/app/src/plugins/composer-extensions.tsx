import { useMemo } from "react";
import { useToast } from "@/contexts/toast-context";
import { createPluginClientStateSource } from "./client-state/source";
import { PluginEnvironmentProvider } from "./popover";
import { useInstalledPlugins } from "./registry";
import { SurfaceErrorBoundary } from "./surface-error-boundary";
import type { InstalledPlugin } from "./types";

interface ComposerScope {
  serverId: string;
  workspaceId: string;
  agentId: string;
}

function InstalledComposerExtensions({
  installation,
  serverId,
  workspaceId,
  agentId,
}: ComposerScope & { installation: InstalledPlugin }) {
  const toast = useToast();
  const state = useMemo(() => createPluginClientStateSource(serverId), [serverId]);
  const environment = useMemo(() => ({ installation, state, toast }), [installation, state, toast]);
  return (installation.composerExtensions ?? []).map(({ id, Component }) => (
    <SurfaceErrorBoundary key={`${id}:${agentId}`} installation={installation} Surface={Component}>
      <PluginEnvironmentProvider environment={environment}>
        <Component agentId={agentId} workspaceId={workspaceId} />
      </PluginEnvironmentProvider>
    </SurfaceErrorBoundary>
  ));
}

export function PluginComposerExtensions(props: ComposerScope) {
  const plugins = useInstalledPlugins();
  return plugins
    .filter((plugin) => plugin.serverId === props.serverId)
    .map((installation) => (
      <InstalledComposerExtensions key={installation.id} installation={installation} {...props} />
    ));
}
