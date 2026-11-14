# WORK-418: Mac material diagnostic capture

尚未复现用户报告，根因未确认，未修改生产代码。这些截图不是修复后的验收证据。

输入为 `origin/main` 的 `02c20c4eb`，通过 merge 保留任务起点 `a449296f1`。
用户提供的是输入框底部的两张裁剪截图；“悬浮按钮”具体指哪个控件仍未确认。

## 实际结果

- [首次浏览器运行](browser-initial.txt)：1 passed。强制 `paseoDesktop.platform = darwin`，实际执行 `getIsElectronMac()` 分支。三个 window 根元素背景均为透明；[计算样式与几何](mac-paint.json) 显示 composer clearance 为 148px，scroll-controls 为 `translateY(-148px)`。滚动按钮底边 700px，小于输入框顶边 752px。
- [最终浏览器及 Electron 运行](browser-electron.txt)：1 passed，48.0s。包含对话滚动、实际附件文件写入及预览、附件菜单、快捷键弹窗及关闭后的截图。Electron 中点击滚到底部按钮后，该按钮消失。
- [Electron 版本及窗口](electron-environment.json)：Electron 44.2.0 / Chromium 152.0.7977.76，1200×900。BrowserWindow 使用 `transparent: true`、透明 backgroundColor、无边框；通过桌面桥接强制 Mac 分支。
- [对话](mac-before.png)、[附件](mac-attachment.png)、[菜单](mac-menu.png)、[弹窗](mac-dialog.png)、[关闭后](mac-dismissed.png) 没有出现用户截图中的错位圆角块。
- Electron [滚动及附件](electron-transparent.png)、[菜单](electron-menu.png)、[弹窗](electron-dialog.png)、[关闭后](electron-dismissed.png) 同样没有出现这些块。会话主区底部保持实色，壁纸显示在侧栏。

用例通过只证明当前场景的定位和交互断言通过，不证明用户的问题不存在，也不是修复前失败、修复后通过的回归测试。

## 静态检查

最终用例修订的全仓 typecheck、lint 通过，见 [typecheck](typecheck.txt)、[lint](lint.txt)。执行了全仓 npm run format；它还重排了任务起点自带的 34 个 .turbo/cache JSON 和运行时注入的 CLAUDE.md。已恢复这些非本任务改动。因此最终全仓 format:check 报告这 35 个既有文件格式不符（[原始输出](format-check-baseline.txt)）；本任务修改的用例和证据文件单独检查通过。未运行全量测试、未创建 PR 或触发 CI。

## 运行边界

宿主是 Linux。壁纸是 renderer 根背景，模拟原生材质背后的颜色；没有运行 macOS 的 NSVisualEffectView/vibrancy，也没有复现用户的 GPU、Retina、窗口管理状态或实际会话。Electron 使用 SwiftShader。最小桥接只支持此诊断所需的能力，不是生产 preload 的端到端验证；附件读写调用生产文件处理函数，存储在 testInfo 输出目录内。

第一轮扩大附件场景时，最小桥接没有文件 IPC，导致附件保存失败（[日志](fixture-missing-ipc.txt)）。后续已接入生产附件处理代码。该失败属于夹具，不是用户回归。其他准备失败包括不存在的 Chromium 1208 可执行文件以及 Playwright 对跨包 ESM 的加载；最终用例使用现存 Chromium 1187、esbuild 打包生产附件函数，并直接解析生产 paseo-home 模块。

## 复跑

先完成 `npm ci`、`npm run build:server`、`npm exec -- install-electron`。只运行既有 materials spec 中的本用例：

```bash
E2E_MAC_ELECTRON=1 E2E_GPU_COMPOSITING=1 \
E2E_CHROMIUM_EXECUTABLE_PATH=/data/home/jayjayzhang/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell \
xvfb-run -a --server-args='-screen 0 1600x1200x24' \
npm run test:e2e --workspace=@getpaseo/app -- materials.spec.ts -g 'Mac transparent window reproduction'
```

不设置 `E2E_MAC_ELECTRON` 时只跑强制 Mac 的浏览器场景。截图写到 Playwright 的 test-results，不自动覆盖此证据目录。没有启动或重启端口 6767 的 daemon。

## 下一步需要的实机证据

请 Root 获取异常出现时的整窗截图，并标出“悬浮按钮”和阴影块；同时记录 macOS、Paseo/Electron 版本、显示缩放、窗口是否最大化/全屏及触发操作。裁剪图中的绿色条目前无法区分在窗口内部还是外部。

若可访问受影响的 renderer，在异常仍显示时运行 [inspect-renderer.js](inspect-renderer.js)，返回 JSON 和同一时刻截图。它只读取材质元素的边界与计算样式，不读取会话文本或凭据。用实机数据判断异常像素是否对应实际 DOM 面板，或者是原生合成残影，再做单变量对照。

当前无法有证据地把两种现象归属到具体元素和样式。因此没有提交推测性修复，没有 PR、独立修复审查或 CI 结果；Contract v1 尚未满足，需 Root 补充实机取证或提供可操作的 Mac 复现环境后继续。
