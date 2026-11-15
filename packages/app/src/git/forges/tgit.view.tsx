import { TgitIcon } from "@/components/icons/tgit-icon";
import type { ClientForgeViewModule } from "@/git/client-forge-module";

export const tgitForgeView = {
  id: "tgit",
  icon: TgitIcon,
  brandColor: { light: "#B87900", dark: "#F5C242" },
} satisfies ClientForgeViewModule;
