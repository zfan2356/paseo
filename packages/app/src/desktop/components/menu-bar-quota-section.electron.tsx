import { useCallback, useMemo } from "react";
import { SettingsCard, SettingsSelect, SettingsSection } from "@/components/settings";
import { getDesktopHost } from "@/desktop/host";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { useMenuBarQuotas } from "@/desktop/menu-bar/use-menu-bar-quotas.electron";
import { menuBarQuotaItems } from "../../../../desktop/src/features/menu-bar/quotas";
import {
  DEFAULT_MENU_BAR_QUOTA,
  type MenuBarQuotaPreference,
} from "../../../../desktop/src/features/menu-bar/quota-preference";

export function MenuBarQuotaSection() {
  const { settings, isLoading, isSaving, updateSettings } = useDesktopSettings();
  const reports = useMenuBarQuotas();
  const preference = settings.menuBarQuota ?? DEFAULT_MENU_BAR_QUOTA;
  const options = useMemo(() => {
    const accounts = menuBarQuotaItems(reports, Date.now());
    const result = [
      { value: "auto", label: "自动（优先 Codex）" },
      ...accounts.map((account) => ({ value: account.accountId, label: account.title })),
    ];
    if (
      preference.accountId &&
      !accounts.some((account) => account.accountId === preference.accountId)
    ) {
      result.push({ value: preference.accountId, label: "已选账号（暂不可用）" });
    }
    return result;
  }, [reports, preference.accountId]);
  const changeAccount = useCallback(
    (value: string) => {
      void updateSettings({ menuBarQuota: { accountId: value === "auto" ? null : value } }).catch(
        () => {},
      );
    },
    [updateSettings],
  );
  const changeDisplay = useCallback(
    (display: MenuBarQuotaPreference["display"]) => {
      void updateSettings({ menuBarQuota: { display } }).catch(() => {});
    },
    [updateSettings],
  );
  if (getDesktopHost()?.platform !== "darwin") return null;
  return (
    <SettingsSection
      title="菜单栏额度"
      info="在 macOS 菜单栏显示所选账号的额度百分比。多额度窗口取剩余最少的一项；缓存数据以 ~ 标记。"
    >
      <SettingsCard>
        <SettingsSelect
          label="显示账号"
          value={preference.accountId ?? "auto"}
          options={options}
          onValueChange={changeAccount}
          disabled={isLoading || isSaving}
        />
        <SettingsSelect
          label="显示方式"
          value={preference.display}
          options={[
            { value: "remaining", label: "剩余百分比" },
            { value: "used", label: "已用百分比" },
            { value: "hidden", label: "隐藏数字" },
          ]}
          onValueChange={changeDisplay}
          disabled={isLoading || isSaving}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
