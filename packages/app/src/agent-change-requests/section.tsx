import { MATERIAL_SLOTS } from "@/styles/material-slots";
import { getForgeDefinitionOrNeutral } from "@getpaseo/protocol/forge-manifest";
import { ControlSizeProvider } from "@/components/ui/control-size";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { createPaseoApi, type AgentChangeRequestsSnapshot } from "@getpaseo/client";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { ScrollView } from "@/components/ui/scroll-view";
import { openExternalUrl } from "@/utils/open-external-url";
import { openChangeRequests } from "./model";

export function AgentChangeRequestsSection({
  serverId,
  agentId,
  draft,
}: {
  serverId: string;
  agentId: string;
  draft: boolean;
}) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const active = useRetainedPanelActive();
  if (draft || !active || !connected || !client) return null;
  return <ConnectedChangeRequests key={agentId} client={client} agentId={agentId} />;
}

function ConnectedChangeRequests({ client, agentId }: { client: DaemonClient; agentId: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const compact = useIsCompactFormFactor();
  const supported = client.supportsAgentChangeRequests();
  if (!supported) return null;
  return (
    <ControlSizeProvider size={compact ? "md" : "sm"}>
      <ChangeRequestsList
        key={agentId}
        client={client}
        agentId={agentId}
        expanded={expanded}
        toggle={toggle}
        label={t("agentChangeRequests.title")}
      />
    </ControlSizeProvider>
  );
}

export function ChangeRequestsList({
  client,
  agentId,
  expanded,
  toggle,
  label,
}: {
  client: DaemonClient;
  agentId: string;
  expanded: boolean;
  toggle: () => void;
  label: string;
}) {
  const [model] = useState(() => {
    const api = createPaseoApi(client);
    const form = openChangeRequests({
      read: api.agents.ref(agentId).changeRequests,
      update: (options) => client.updateAgentChangeRequests(agentId, options),
    });
    return {
      ...form,
      close: () => {
        form.close();
        void api
          .dispose()
          .catch((error) => console.error("Change request API cleanup failed", error));
      },
    };
  });
  useEffect(() => {
    model.start();
    return model.close;
  }, [model]);
  return <ChangeRequestsView model={model} expanded={expanded} toggle={toggle} label={label} />;
}

export function ChangeRequestsView({
  model,
  expanded,
  toggle,
  label,
}: {
  model: ReturnType<typeof openChangeRequests>;
  expanded: boolean;
  toggle: () => void;
  label: string;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const count = state.snapshot?.items.length ?? 0;
  return (
    <View
      style={styles.container}
      dataSet={expanded ? MATERIAL_SLOTS.secondaryExpanded : MATERIAL_SLOTS.secondary}
    >
      <Button
        variant="ghost"
        style={styles.headerButton}
        onPress={toggle}
        testID="agent-change-requests-toggle"
      >
        {label} · {count}
      </Button>
      {expanded ? (
        <ScrollView style={styles.list}>
          <View style={styles.body}>
            {state.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {state.error}
              </Text>
            ) : null}
            {!state.snapshot ? (
              <Text style={styles.muted}>{t("agentChangeRequests.loading")}</Text>
            ) : (
              <>
                <View style={styles.row}>
                  <Text style={styles.text}>{t("agentChangeRequests.autoLink")}</Text>
                  <Switch
                    value={state.snapshot.autoLink}
                    onValueChange={model.setAutoLink}
                    disabled={state.busy}
                    accessibilityLabel={t("agentChangeRequests.autoLink")}
                  />
                </View>
                {count === 0 ? (
                  <Text style={styles.muted}>{t("agentChangeRequests.empty")}</Text>
                ) : null}
                {state.snapshot.items.map((item) => (
                  <ChangeRequestRow
                    key={item.reference.key}
                    item={item}
                    disabled={state.busy}
                    remove={model.remove}
                  />
                ))}
                <ChangeRequestAddForm model={model} />
              </>
            )}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function ChangeRequestAddForm({ model }: { model: ReturnType<typeof openChangeRequests> }) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  return (
    <>
      <View style={styles.inputRow}>
        <View style={styles.input}>
          <Field label={t("agentChangeRequests.url")}>
            <FormTextInput
              key={state.inputRevision}
              onChangeText={model.setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t("agentChangeRequests.url")}
              editable={!state.busy}
            />
          </Field>
        </View>
        <Button
          variant="default"
          disabled={state.busy || !state.url.trim()}
          onPress={model.add}
          testID="agent-change-requests-add"
        >
          {t("agentChangeRequests.add")}
        </Button>
      </View>
      <Text style={styles.muted}>{t("agentChangeRequests.hint")}</Text>
    </>
  );
}

function ChangeRequestRow({
  item,
  disabled,
  remove,
}: {
  item: AgentChangeRequestsSnapshot["items"][number];
  disabled: boolean;
  remove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const open = useCallback(() => {
    void openExternalUrl(item.reference.url);
  }, [item.reference.url]);
  const removeItem = useCallback(() => remove(item.reference.key), [remove, item.reference.key]);
  const numberLabel =
    getForgeDefinitionOrNeutral(item.reference.forge).changeRequestNumberPrefix +
    item.reference.number;
  const status = item.status;
  let lifecycle = t("agentChangeRequests.pending");
  if (status) lifecycle = status.isDraft ? "draft" : status.state;
  const availability = t(`agentChangeRequests.availability.${item.availability}`, {
    defaultValue: item.availability,
  });
  return (
    <View style={styles.item}>
      <View style={styles.row}>
        <Button variant="ghost" style={styles.link} onPress={open}>
          {item.reference.projectPath} {numberLabel}
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onPress={removeItem}
          accessibilityLabel={
            t("agentChangeRequests.remove") + " " + item.reference.projectPath + " " + numberLabel
          }
        >
          {t("agentChangeRequests.remove")}
        </Button>
      </View>
      {status ? <Text style={styles.text}>{status.title}</Text> : null}
      <Text style={styles.muted}>
        {status ? lifecycle : availability}
        {status && item.availability !== "available" ? ` · ${availability}` : ""}
        {status && item.stale ? ` · ${t("agentChangeRequests.stale")}` : ""}
      </Text>
      {status ? (
        <Text style={styles.muted}>
          CI: {status.checksStatus ?? "none"} · {t("agentChangeRequests.review")}:{" "}
          {status.reviewDecision ?? "—"} · {t("agentChangeRequests.merge")}: {status.mergeable}
        </Text>
      ) : null}
      {item.refreshedAt ? (
        <Text style={styles.muted}>
          {t("agentChangeRequests.refreshed")}: {new Date(item.refreshedAt).toLocaleTimeString()}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  headerButton: { alignSelf: "flex-start" },
  link: { flexShrink: 1, justifyContent: "flex-start" },
  input: { flex: 1, minWidth: 0 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: theme.spacing[2] },
  list: { maxHeight: 340 },
  body: { padding: theme.spacing[4], gap: theme.spacing[3] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  item: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
