# X2 图标线宽：评估与 Discussion 草稿

## 评估

- 上游已经有全局默认：`_layout.tsx` 用 `LucideProvider strokeWidth={ICON_STROKE_WIDTH}`，`ICON_STROKE_WIDTH = 1.5`（`styles/theme.ts`），design.md §4 也写了 “the app's 1.5px stroke”。所以默认值是统一的，不存在 “没设就是 2” 的情况。
- 字面量覆盖集中在少数界面（`git grep` 粗计，含非图标 SVG）：
  - 命令中心根项图标 2.2（`command-center/root-registration.tsx` 11 处，`command-center.tsx` 1 处）、加号 2.4。
  - 语音和听写控件 2.5（`dictation-controls.tsx`、`realtime-voice-overlay.tsx`），都是实心圆盘里的小图标。
  - review 界面 2.4，onboarding 3，设置侧栏显式写 1.5。
- 这些覆盖是按界面成组出现的，像是有意加粗小号或反色图标，不是随手写错。没有一个能写成 “修复前失败” 的测试，也没有用户可复现的故障。结论：不提 PR，作为设计讨论。

## Discussion 草稿要点（只是草稿，不发布）

标题建议：Icon stroke weight: one rule per glyph size?

- **现状。** 默认 1.5 由 `LucideProvider` 统一下发；命令中心（2.2/2.4）、听写和语音控件（2.5）、review（2.4）、onboarding（3）在调用处写死更粗的线宽。同一屏里会出现 1.5 和 2.2 的图标相邻，例如命令中心列表和侧栏。
- **问题。** 线宽跟着调用处走，而不是跟着图标尺寸和所处的底色走。新加界面时没有规则可依，评审只能看截图判断。
- **想确认的设计意图。** 这些加粗是不是为了：小于 16pt 的图标保持可见；实心圆盘上的反色图标不发虚；命令中心要和输入文字的字重匹配。
- **可能的规则。** 线宽由尺寸决定，放在 token 里，例如 `ICON_SIZE.sm`/`md` 用 1.5，实心底上的反色图标用一个单独的加粗值；调用处不再写字面量。
- **不打算改的。** 不换图标库，不改默认 1.5，不动 design.md §4 的工具栏规格。
- **需要维护者回答的。** 现在的加粗是否都有意保留；如果有规则，是否愿意写进 design.md，以便后续 PR 照着做。
