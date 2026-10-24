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
- 操作栏改为底部悬浮胶囊（HarmonyOS 风格三键 + 截图），不占画面高度；顶部设备下拉/清晰度/旋转/更多；断开连接收进设备菜单并二次确认
- 顶部新增清晰度切换：流畅 360x800/2M、标准 540x1200/6M、高清 720x1600/10M，只影响流输出，不改设备分辨率
- 胶囊细节：返回键改为 Android 三角、按钮 42px、上下留距 24px、玻璃材质（blur + 高光 + 阴影）
- 修复云手机画面比例：`wm size` 优先 Override size；流的 size 按设备实际比例等比缩放（同一档在不同设备输出不同分辨率）
- 清晰度改为按设备 serial 记忆；只在选中设备后显示切换按钮
- 设备图标按系统显示：Android 机器人 / HarmonyOS / iOS（iOS 待 transport），22px 实心标记、无底色；行内同时显示连接方式与系统两个小标签
- 测试：`npm run smoke`（含 targets 存储、getprop 解析、平台判定）、`scripts/render-test.mjs`（列表/预览/浮窗/诊断/流五种状态）
