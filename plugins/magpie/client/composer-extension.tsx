import { useEffect, useRef } from "react";
import { useAgent, type PluginClientContext } from "@getpaseo/plugin/client";
import { createComposerControls } from "./composer.js";

export function registerComposerControls(client: PluginClientContext) {
  // COMPAT(composerExtensions): older fork clients retain native controls; remove after 2027-04-29.
  if (client.features?.composerExtensions !== true) return () => {};
  function ComposerControls({ agentId }: { agentId: string; workspaceId: string }) {
    const agent = useAgent(agentId, (snapshot) => ({
      id: snapshot.id,
      workspaceId: snapshot.workspaceId,
      provider: snapshot.provider,
      model: snapshot.model,
      fast: snapshot.featureValues?.fast_mode,
      tier: snapshot.featureValues?.service_tier,
    }));
    const controller = useRef<ReturnType<typeof createComposerControls> | null>(null);
    useEffect(() => {
      controller.current = createComposerControls(client);
      return () => {
        controller.current?.dispose();
        controller.current = null;
      };
    }, []);
    useEffect(() => {
      controller.current?.update(
        agent
          ? {
              ...agent,
              featureValues: { fast_mode: agent.fast, service_tier: agent.tier },
            }
          : null,
      );
    }, [agent]);
    return null;
  }
  return client.addComposerExtension({ id: "magpie-controls", Component: ComposerControls });
}
