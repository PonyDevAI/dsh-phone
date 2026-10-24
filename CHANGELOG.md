# Changelog

## 0.1.0 — 2026-10-24

- 首个可用版本：右侧栏「手机」tab + 会话头部手机图标
- 设备列表：USB / Wi-Fi / 模拟器 / 云手机分组，含状态点
- 预览：轮询 `adb exec-out screencap -p`，等比机身 bezel，无元数据栏、无输入框
- 点按 / 拖拽 → `adb shell input tap|swipe`
- 顶栏：设备下拉、返回 / 主页 / 多任务 / 截图 / 更多（电源、旋转、重连、复制 serial、断开）
- 连接：`adb connect <ip>:<port>`
- Host：`/phone/*` 路由 + `connection.admit` 认证围栏；serial 白名单；execFile 无 shell
- 常用连接目标：连接成功自动记录（`$DSH_HOME/phone/targets.json`，最近 12 条），未连接目标也显示在列表，点击直接 `adb connect`
- `⋯ → adb 诊断`：adb 路径/版本、每台设备状态，可复制
- 列表改为平铺，不再按「云手机」分组；只保留连接方式标签（USB / Wi-Fi / Tailscale / emulator）
- Tailscale 判定：`unicom-openclaw-*`、`*.ts.net`、`100.64.0.0/10`
- 真机验证：Pixel 7a 上 tap / swipe / 返回 / 主页 均已实测（点开「网络和互联网」「关于本机」，列表滚动）
- H.264 实时预览：Host `POST /phone/stream` 直接 pipe `screenrecord --output-format=h264`；客户端 Annex-B → avcC → WebCodecs VideoDecoder → canvas，约 20–30fps
- 不支持 WebCodecs 的浏览器自动回退截图轮询；`screen-info` 提供设备真实分辨率做坐标换算
- 操作栏改为底部三键 + 截图，顶部只留设备下拉/旋转/更多；断开连接收进设备菜单并二次确认
- 设备图标按系统显示：Android 机器人 / HarmonyOS / iOS（iOS 待 transport），20px 实心标记、无底色，贴合 DSH 列表图标规范
- 测试：`npm run smoke`（含 targets 存储、getprop 解析、平台判定）、`scripts/render-test.mjs`（列表/预览/浮窗/诊断/流五种状态）
