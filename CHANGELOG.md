# Changelog

## 0.2.2 — 2026-10-24

### 修复
- 客户端 bundle 的 `__ModuleLoader__` id 从 `dsh-phone` 改为 `@ponydev/dsh-phone`，修复迁移后 client-modules 报 “loaded without registering” 导致插件加载失败

## 0.2.1 — 2026-10-24

### 变更
- 旧裸包 `dsh-phone` 已从 npm **完全删除**（0.1.0 / 0.1.1 不再保留 deprecated 路标）
- 发版入口只剩 `@ponydev/dsh-phone`；本版本同时用于验证 scoped 包的 OIDC 自动发布链路

## 0.2.0 — 2026-10-24

### 变更
- 包名迁移：`dsh-phone` → **`@ponydev/dsh-phone`**，与 `dsh-model-usage` / `dsh-tailscale` 统一 scope
- `cordis.patch.yml` 的 bundle 行改为 `@ponydev/dsh-phone`；本地 web profile 同步迁移（link 安装）
- 新包已配置 npm Trusted Publisher（OIDC），后续 tag 发版免 2FA

### 移除
- 裸包 `dsh-phone` 标记 deprecate，指向 `@ponydev/dsh-phone`
- npm 上的 `dsh-phone@0.0.0-stage` 占位版本已删除

## 0.1.1 — 2026-10-24

### 变更
- 仓库规范与 `dsh-model-usage` / `dsh-tailscale` 对齐：补 `AGENTS.md`、`docs/DESIGN.md`、scripts 命名（`check-i18n` / `release-notes`）、npm `files`、CI/release workflow
- 发布内容补齐 `docs`、`AGENTS.md`、`CONTRIBUTING.md`、`RELEASE.md`
- npm Trusted Publisher（OIDC）配置完成，后续 tag 发版免 2FA
- 文档目录整理：`docs/DESIGN.md`、`docs/mockups/`、`docs/screenshots/01..03`

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
- 预览放大：顶部对齐、边距压到最小（高度约占舞台 88%）；`⋯ → 沉浸模式` 可隐藏胶囊再放大
- 胶囊收紧凑：高度 54→42、按钮 42→36、上下 padding 6→3、左右 12→14，两端为标准半圆（半径=高度/2）
- 设备图标按系统显示：Android 机器人 / HarmonyOS / iOS（iOS 待 transport），22px 实心标记、无底色；行内同时显示连接方式与系统两个小标签
- 测试：`npm run smoke`（含 targets 存储、getprop 解析、平台判定）、`scripts/render-test.mjs`（列表/预览/浮窗/诊断/流五种状态）
