import { openExternalUrl } from "@/utils/open-external-url";
import { useCallback, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import { LiveElapsed } from "@/components/message";
import { Button } from "@/components/ui/button";
import type { PaseoAgentBackgroundWorkItem } from "@getpaseo/client";
import { createHostBackgroundWorkModel } from "./host";
import { backgroundWorkText } from "./presentation";
export { createHostBackgroundWorkModel } from "./host";

function kindKey(kind: string): "shell" | "monitor" | "other" {
  if (kind === "shell" || kind === "monitor") return kind;
  return "other";
}

export function BackgroundWorkTrack({
  model,
  count,
}: {
  model: ReturnType<typeof createHostBackgroundWorkModel>;
  count: number;
}) {
  const { t } = useTranslation();
  const { items, status, stops } = useSyncExternalStore(
    model.subscribe,
    model.getSnapshot,
    model.getSnapshot,
  );
  const missing = Object.values(stops ?? {}).filter(
    (entry) => !items?.some((item) => item.stopToken === entry.item.stopToken),
  );
  const rows = [...(items ?? []), ...missing.map((entry) => entry.item)];
  if (count === 0 && rows.length === 0) return null;
  const visibleCount = items ? items.filter((item) => item.kind !== "source").length : count;
  const unavailable = rows.some((item) => item.external && item.external.freshness !== "ready");
  let pillText = t("message.backgroundWork.pillMany", { count: visibleCount });
  if (visibleCount === 1) pillText = t("message.backgroundWork.pillOne");
  if (unavailable && visibleCount === 0) pillText = t("message.backgroundWork.unavailable");
  return (
    <ComposerTrackPill
      testID="background-work"
      panelTitle={t("message.backgroundWork.title")}
      segments={[
        {
          bucket: rows.some((item) =>
            item.external ? item.external.running : item.kind !== "source",
          )
            ? "running"
            : "attention",
          text: pillText,
        },
      ]}
    >
      {status === "loading" || status === "stale" ? (
        <ComposerTrackRow>
          <Text style={styles.facts}>{t("message.backgroundWork.waiting")}</Text>
        </ComposerTrackRow>
      ) : null}
      {status === "error" ? (
        <>
          <ComposerTrackRow>
            <Text style={styles.facts}>{t("message.backgroundWork.error")}</Text>
          </ComposerTrackRow>
          <ComposerTrackRow
            onPress={model.retry}
            closeOnSelect={false}
            accessibilityLabel={t("message.backgroundWork.retry")}
          >
            <Text style={styles.title}>{t("message.backgroundWork.retry")}</Text>
          </ComposerTrackRow>
        </>
      ) : null}
      {rows.map((item) => (
        <BackgroundWorkRow
          key={item.stopToken ?? item.id}
          item={item}
          model={model}
          live={Boolean(
            items?.some((entry) => entry.id === item.id && entry.stopToken === item.stopToken),
          )}
          ready={status === "ready"}
          stopStatus={stops?.[item.stopToken ?? ""]?.status}
        />
      ))}
    </ComposerTrackPill>
  );
}

function BackgroundWorkRow({
  item,
  model,
  live,
  ready,
  stopStatus,
}: {
  item: PaseoAgentBackgroundWorkItem;
  model: ReturnType<typeof createHostBackgroundWorkModel>;
  live: boolean;
  ready: boolean;
  stopStatus?: "pending" | "error";
}) {
  const { t } = useTranslation();
  const kind = t(`message.backgroundWork.${kindKey(item.kind)}`);
  const stop = useCallback(() => {
    void model.stopItem(item);
  }, [model, item]);
  const dismiss = useCallback(
    () => model.dismissStop(item.stopToken ?? ""),
    [model, item.stopToken],
  );
  let detail = t("message.backgroundWork.notRunning");
  if (stopStatus === "pending") detail = t("message.backgroundWork.stopping");
  const { title, command } = backgroundWorkText(item, kind);
  const external = item.external;
  const action = item.canStop && ready && live && (!external || external.freshness === "ready");
  const stopLabel = external
    ? t("message.backgroundWork.cancelLocal")
    : t("message.backgroundWork.stop");
  const label = stopStatus === "pending" ? t("message.backgroundWork.stopping") : stopLabel;
  return (
    <ComposerTrackRow>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        {command ? <Text style={styles.facts}>{command}</Text> : null}
        {external ? (
          <ExternalWorkFacts item={item} ready={ready && live} />
        ) : (
          <Text style={styles.facts}>
            {kind} ·{" "}
            {live ? (
              <LiveElapsed startedAt={new Date(item.startedAt)} active style={styles.facts} />
            ) : (
              detail
            )}
          </Text>
        )}
        {stopStatus === "error" ? (
          <Text style={styles.facts}>{t("message.backgroundWork.stopError")}</Text>
        ) : null}
      </View>
      {action ? (
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel={`${stopLabel} ${title}`}
          disabled={stopStatus === "pending"}
          onPress={stop}
        >
          {label}
        </Button>
      ) : null}
      {!live && stopStatus === "error" ? (
        <Button variant="ghost" size="sm" onPress={dismiss}>
          {t("message.backgroundWork.dismiss")}
        </Button>
      ) : null}
    </ComposerTrackRow>
  );
}

function ExternalWorkFacts({
  item,
  ready,
}: {
  item: PaseoAgentBackgroundWorkItem;
  ready: boolean;
}) {
  const { t } = useTranslation();
  const issue = item.external?.issue;
  const openIssue = useCallback(() => {
    if (issue) void openExternalUrl(issue.url);
  }, [issue]);
  const external = item.external;
  if (!external) return null;
  let start = t("message.backgroundWork.unknownStart");
  if (item.startedAt) start = new Date(item.startedAt).toLocaleString();
  const ticking =
    ready && external.freshness === "ready" && external.running && Boolean(item.startedAt);
  return (
    <>
      <Text style={styles.facts}>
        {external.label} · {external.status}
      </Text>
      {item.kind !== "source" ? (
        <Text style={styles.facts}>
          {ticking ? (
            <LiveElapsed startedAt={new Date(item.startedAt)} active style={styles.facts} />
          ) : (
            start
          )}
        </Text>
      ) : null}
      <Text style={styles.facts}>
        {t(`message.backgroundWork.freshness.${external.freshness}`)}
        {external.observedAt ? ` · ${new Date(external.observedAt).toLocaleString()}` : ""}
      </Text>
      {external.deadline ? (
        <Text style={styles.facts}>
          {t("message.backgroundWork.deadline")} · {new Date(external.deadline).toLocaleString()}
        </Text>
      ) : null}
      {external.finishedAt ? (
        <Text style={styles.facts}>
          {t("message.backgroundWork.finished")} · {new Date(external.finishedAt).toLocaleString()}
        </Text>
      ) : null}
      {issue ? (
        <Button variant="ghost" size="sm" onPress={openIssue}>
          {issue.label}
        </Button>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0 },
  title: { fontSize: theme.fontSize.base, color: theme.colors.foreground },
  facts: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
