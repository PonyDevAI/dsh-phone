# Changelog

## 0.4.4 — 2026-10-26

### 变更
- 头部手机按钮不再显示数字角标，改为右上角 6px 小圆点（在线设备提示）；设备数量放进 tooltip（`手机 · 3`），避免角标抢视觉

## 0.4.3 — 2026-10-26

### 变更
- 会话头部手机按钮：28px 按钮 + 18px 图标（原 30/16），左右留白更小、图标更清楚
- 消息计数角标缩小并移到右下角：10px 高、7.5px 字号、外圈 1.5px 背景描边，不再盖住手机图标

## 0.4.2 — 2026-10-26

### 修复
- 暗黑模式下手机图标变成实心白块：DSH 的 guide/tab 容器会给 `svg` 继承 `fill`，轮廓图标被填满。现在所有 outline 图标用 inline `style="fill:none"`（优先级高于容器 CSS），实心平台图标（Android/HarmonyOS/Apple）单独保留 `fill:currentColor`
- 手机图标重绘：机身 + 听筒线 + Home 指示条，16px 下也能辨认

## 0.4.1 — 2026-10-26

### 修复
- 鸿蒙模拟器名称规则与 CLI 对齐：只允许字母、数字、空格、下划线 `_`、加号 `+`（之前允许连字符/中文，`-create` 会直接失败）；创建表单占位符改为 `dsh_phone_hos`
- 鸿蒙模拟器 `start` 改为 detached 启动 + 截图 warm-up：`Emulator -start` 是常驻进程，之前前台等待导致 90s 超时；现在启动后等显示服务就绪再返回

### 验证（0.4.1 发布前实测）
- iOS 模拟器：create → boot → 截图 → H.264 流（idb，100 帧/3s）→ tap / Home 通过；像素→point（density=3）用真实弹窗按钮验证
- HarmonyOS 模拟器：create → start（45s 含 warm-up）→ 截图 → tap / swipe → stop → delete 全链路通过
- HarmonyOS 真机（Mate 60 Pro）：截图 / keyEvent / tap / text 通过

## 0.4.0 — 2026-10-26

### 新增
- **iOS 模拟器**：`xcrun simctl` 列表 / 创建 / boot / 关机 / 删除 / 截图；面板可自动进入并轮询预览
- **HarmonyOS 模拟器**：DevEco `Emulator` CLI 列表 / 创建 / 启动 / 停止 / 删除 / 截图 / 点击 / 滑动 / 旋转 / 电源
- **HarmonyOS 真机**：`hdc` 设备列表 / 截图 / 点击 / 滑动 / 按键 / 文字输入
- 「添加设备」菜单：Android 连接 / 创建 iOS 模拟器 / 创建鸿蒙模拟器
- 设备操作菜单：iOS 模拟器关机 / 删除，鸿蒙模拟器停止 / 删除
- 平台图标与标签：iOS 模拟器、HarmonyOS 模拟器 / 真机

### 变更
- Host `/phone/*` 按设备 transport 分发（adb / simctl / emulator / hdc）；`health` 返回 iOS 与 HarmonyOS 能力
- 鸿蒙暂不支持实时流，自动回退截图轮询（iOS 实时流与输入需要 idb，未装时只读预览）
- 新增 `lib/ios.js`、`lib/hos.js` 与 `scripts/hos-smoke.mjs`

## 0.3.2 — 2026-10-26

### 变更
- 隐私清理：文档、mockup、冒烟测试与离线 harness 里的真实设备序列号 / Tailscale CGNAT IP / 私有主机名统一替换为示例值
- 新增 `scripts/check-privacy.mjs` 与 `scripts/check-shots.mjs` 门禁，接入 `npm run check`、CI 与 release workflow
- npm `files` 的 `docs` 收紧为 `docs/*.md`，不再把 docs 截图 / mockup 图片打包进发布物
- 截图：删除真实截图 `01-devices` / `02-preview` 与 mockups 图片，只保留由 `scripts/render-test.mjs` + 假 fixtures 重生成的 `03-overview`，并在 `docs/screenshots/MANIFEST.md` 登记来源

## 0.3.1 — 2026-10-25

### 修复
- 云手机在平台侧切换分辨率后画面比例不跟随：预览每 3s 用 `screen-info?fresh` 检测 `wm size`，变化时自动重连流并按新尺寸重启 screenrecord
- 顶部新增当前流分辨率显示（如 `540×960 · 58fps · 20ms`）

## 0.3.0 — 2026-10-24

### 新增
- 打开手机面板自动进入预览：优先本会话上次使用的设备（localStorage 按 sessionId 记忆），否则第一台在线设备
- 顶部清晰度右侧显示实时 **FPS** 和 **adb 往返延迟**（每 5s 探测一次）
- 没有可用设备时，居中空态 + 「+ 连接设备」按钮

### 变更
- 「设备列表」仍可从左上角设备下拉进入；自动进入只发生在面板首次挂载

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
- Tailscale 判定：`*.ts.net`、`100.64.0.0/10`
- 真机验证：Android 真机上 tap / swipe / 返回 / 主页 均已实测（点开「网络和互联网」「关于本机」，列表滚动）
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
