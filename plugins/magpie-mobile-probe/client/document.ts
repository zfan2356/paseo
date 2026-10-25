export const probeHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
  <title>Magpie mobile probe</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-rounded, sans-serif; }
    body { margin: 0; padding: 24px; background: #123b35; color: #f5f3e7; }
    small { color: #b6d6bc; letter-spacing: 2px; }
    h1 { font-size: 28px; margin: 20px 0; }
    p { line-height: 1.6; }
    button { border: 0; border-radius: 12px; background: #e6efad; color: #123b35;
      padding: 16px 20px; font: inherit; font-weight: bold; }
    #count { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <small>MAGPIE / OFFLINE PROBE</small>
  <h1>内嵌网页已显示</h1>
  <p id="status">正在检查 JavaScript…</p>
  <button id="tap" type="button">点击测试回传</button>
  <p>点击次数：<span id="count">0</span></p>
  <p>此页面完全离线，不访问 Magpie，也不读取账号。</p>
  <script>
    function send(message) {
      var bridge = window.ReactNativeWebView;
      if (bridge && typeof bridge.postMessage === "function") {
        bridge.postMessage(message);
      }
    }
    document.getElementById("status").textContent = "JavaScript 已运行";
    document.getElementById("tap").addEventListener("click", function () {
      var count = document.getElementById("count");
      count.textContent = String(Number(count.textContent) + 1);
      send("clicked");
    });
    send("ready");
  </script>
</body>
</html>`;
