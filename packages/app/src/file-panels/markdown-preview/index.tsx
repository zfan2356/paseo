import { MarkdownRenderer } from "@/components/markdown/renderer";
import { resolveMarkdownFileDirectory } from "@/components/markdown/image-source";
import {
  AssistantFileLinkResolverProvider,
  useAssistantFileLinkEnvironment,
} from "@/assistant-file-links";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useEffect, useId, useMemo } from "react";
import { isWeb } from "@/constants/platform";
import { usePaneContext } from "@/panels/pane-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { MarkdownHeadingSlugger, resolveMarkdownPreviewLink, sameMarkdownDocument } from "./links";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { parseMarkdownPreviewDocument } from "./document";

export function FileMarkdownPreview({
  source,
  anchor,
  navigationRevision,
  filePath,
  workspaceRoot,
  client,
  serverId,
}: {
  source: string;
  anchor?: string;
  navigationRevision?: number;
  filePath: string;
  workspaceRoot?: string;
  client?: DaemonClient | null;
  serverId?: string;
}) {
  const previewId = useId();
  const { openFileInWorkspace } = usePaneContext();
  const navigateLink = useStableEvent((href: string) => {
    const target = resolveMarkdownPreviewLink(href, filePath);
    if (target.kind === "external") return false;
    if (target.kind === "ignored") return true;
    if (target.anchor && sameMarkdownDocument(target.path, filePath)) {
      scrollToHeading(previewId, target.anchor);
    } else {
      const { kind: _kind, ...location } = target;
      openFileInWorkspace({ location, disposition: "preferred" });
    }
    return true;
  });
  useEffect(() => {
    if (!isWeb || !anchor) return;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => scrollToHeading(previewId, anchor));
    });
    let second = 0;
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [anchor, navigationRevision, previewId, source]);
  const document = useMemo(() => parseMarkdownPreviewDocument(source), [source]);
  const environment = useAssistantFileLinkEnvironment();
  const relativePathBase = resolveMarkdownFileDirectory({ markdownPath: filePath, workspaceRoot });

  return (
    <View nativeID={previewId} style={styles.outerGutter}>
      <View style={styles.readingFrame} testID="markdown-preview-frame">
        {document.frontMatter.length > 0 ? (
          <View style={styles.frontMatterTable} testID="markdown-front-matter">
            {document.frontMatter.map((row, index) => (
              <View
                key={row.key}
                style={[styles.frontMatterRow, index > 0 && styles.frontMatterRowBorder]}
              >
                <View style={styles.frontMatterKeyCell}>
                  <Text selectable style={styles.frontMatterKey}>
                    {row.key}
                  </Text>
                </View>
                <View style={styles.frontMatterValueCell}>
                  <Text selectable style={styles.frontMatterValue}>
                    {row.value}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <AssistantFileLinkResolverProvider
          {...environment}
          relativePathBase={relativePathBase ?? undefined}
        >
          <MarkdownRenderer
            text={document.body}
            onNavigateLink={navigateLink}
            filePath={filePath}
            workspaceRoot={workspaceRoot}
            client={client}
            serverId={serverId}
          />
        </AssistantFileLinkResolverProvider>
      </View>
    </View>
  );
}

function scrollToHeading(previewId: string, anchor: string) {
  if (!isWeb) return;
  const root = document.getElementById(previewId);
  const slugger = new MarkdownHeadingSlugger();
  for (const heading of root?.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]") ?? []) {
    if (slugger.slug(heading.textContent ?? "") === anchor) {
      heading.scrollIntoView({ block: "start" });
      break;
    }
  }
}

const styles = StyleSheet.create((theme) => ({
  outerGutter: {
    width: "100%",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingVertical: theme.spacing[4],
  },
  readingFrame: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  frontMatterTable: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    marginBottom: theme.spacing[6],
  },
  frontMatterRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  frontMatterRowBorder: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  frontMatterKeyCell: {
    flexBasis: "30%",
    maxWidth: 180,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
  },
  frontMatterValueCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  frontMatterKey: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  frontMatterValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
}));
