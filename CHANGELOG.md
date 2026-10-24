# Changelog

## 0.1.0 — 2026-10-24

- 首个可用版本：右侧栏「手机」tab + 会话头部手机图标
- 设备列表：USB / Wi-Fi / 模拟器 / 云手机分组，含状态点
- 预览：轮询 `adb exec-out screencap -p`，等比机身 bezel，无元数据栏、无输入框
- 点按 / 拖拽 → `adb shell input tap|swipe`
- 顶栏：设备下拉、返回 / 主页 / 多任务 / 截图 / 更多（电源、旋转、重连、复制 serial、断开）
- 连接：`adb connect <ip>:<port>`
- Host：`/phone/*` 路由 + `connection.admit` 认证围栏；serial 白名单；execFile 无 shell
- 测试：`npm run smoke`、`scripts/render-test.mjs`
