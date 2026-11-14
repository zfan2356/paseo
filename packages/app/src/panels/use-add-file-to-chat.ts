import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { useCallback, useMemo } from "react";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export function useAddFileToChat(input: {
  serverId: string;
  workspaceId?: string | null;
  directory?: string;
}) {
  const workspaceKey = input.workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId: input.serverId, workspaceId: input.workspaceId })
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const focusedChat = useMemo(
    () => resolveFocusedChatTarget({ serverId: input.serverId, layout }),
    [input.serverId, layout],
  );
  const addFile = useCallback(
    async (filePath: string) => {
      if (!focusedChat || !workspaceKey) {
        return;
      }
      await useDraftStore.getState().attachWorkspaceFile({
        draftKey: focusedChat.draftKey,
        attachment: createWorkspaceFileAttachment({
          path: input.directory
            ? buildAbsoluteExplorerPath({ workspaceRoot: input.directory, entryPath: filePath })
            : filePath,
        }),
      });
      revealWorkspaceTab(workspaceKey, focusedChat.tabId);
    },
    [focusedChat, workspaceKey, input.directory],
  );
  return { addFile, canAddToChat: focusedChat !== null };
}
