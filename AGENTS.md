# AGENTS.md — dsh-phone 项目规范（AI / 自动化代理）

本文件是**在这个仓库里工作时必须遵守的项目级规范**。全局规范见 `~/.dsh/AGENTS.md`；本文件只写项目特有约束。架构、布局与取舍见 [`docs/DESIGN.md`](docs/DESIGN.md)。

## 0. 一句话

DSH Web 插件：**右侧栏预览并点按控制已连接的 Android 设备**（adb），H.264 实时流 + 无 WebCodecs 时回退截图轮询。

**能力边界**：只认 adb（Android）。hdc（鸿蒙）与 iOS 走 `lib/transport.js` 的 `PhoneTransport` 接口后续接入；UI 容器固定用 DSH 原生 `sidebar-right`，不自造悬浮层。

## 1. 目录与职责

```
lib/index.js      Host 入口（/phone/* RPC、connection.admit 围栏、targets、stream 路由、错误映射）
lib/adb.js        adb 定位 / devices 解析 / getprop 平台 / wm size / 截图 / 输入 / 串行化
lib/stream.js     screenrecord H.264 子进程（续接、背压、断开 kill）、清晰度预设、按比例算 size
lib/targets.js    常用连接目标（$DSH_HOME/phone/targets.json，0600，只存地址/时间）
lib/transport.js  PhoneTransport 接口 + AdbTransport（hdc / iOS 的挂载点）
lib/client.js     ModuleLoader bundle（tab 类型、列表、预览、WebCodecs、i18n、样式）
cordis.patch.yml  bundle 补丁（插入 phone 行、默认配置）
scripts/smoke.mjs            离线冒烟（解析/白名单/targets/尺寸计算；有 adb 时做真实列表）
scripts/check-i18n.mjs       zh/en 字典键一致 + 代码用键存在
scripts/release-notes.mjs    从 CHANGELOG 抽取当前版本条目
scripts/render-test.mjs      离线渲染 harness（列表/预览/浮窗/诊断/流五种状态）
docs/DESIGN.md                架构与布局；docs/mockups 原型；docs/screenshots 截图
```

**约束**：Host 与 Client 不能互相 import；Client 不读文件/环境变量；跨端数据只走 `/phone/*` RPC。

## 2. 修改前必须做

1. `git status`、`git log --oneline -3`、`git worktree list` 确认工作区状态；
2. 涉及 UI 先读 [`docs/DESIGN.md`](docs/DESIGN.md)；
3. 涉及设备操作先在真机确认（USB 优先）；不要假设云手机型号/分辨率。

## 3. 提交前必须通过

```bash
npm run check        # 语法 + i18n + 隐私/截图门禁
npm run smoke        # 解析/白名单/targets/尺寸（无 adb 自动 SKIP）
npm pack --dry-run   # 发布内容检查
```

CI 重复执行以上检查；失败不合并。

## 3.1 隐私与截图门禁（不可绕过）

1. `docs/screenshots/`、`docs/mockups/` 下的图**只能**由 `scripts/render-test.mjs` + **假 fixtures** 生成，禁止提交真机 / 真实账户截图；
2. docs 截图必须在 `docs/screenshots/MANIFEST.md` 登记来源（`- \`路径\` ← \`scripts/xxx.mjs\``），由 `scripts/check-shots.mjs` 强制；
3. 提交前 `npm run check` 已包含 `scripts/check-privacy.mjs` + `scripts/check-shots.mjs` 隐私门禁；命中即失败，不要为通过而放宽规则。

## 4. 安全不变量（不可破坏）

1. **serial 白名单**：`shot` / `input` / `stream` / `screen-info` 前，serial 必须出现在最新 `adb devices -l` 里；
2. 一律 `execFile('adb', [args...])`，不拼 shell；`connect` 地址走 `host:port` 正则；
3. 不暴露任意 `adb shell`；不实现 root；
4. 路由复用 `connection.admit` 的 Host/Origin + Cookie 认证，未认证 401；
5. `targets.json` 只存地址和最近使用时间，权限 600，不存凭据；
6. 日志不打印凭据、完整截图或设备个人数据。

## 5. UI 规范（DSH 原生）

- 只用 `--dsw-*` token，禁止硬编码色值（fallback 除外）；
- 文案全走 i18n（zh/en 键完全一致，`scripts/check-i18n.mjs` 强制）；
- 列表：平铺一列，平台图标（Android/HarmonyOS/iOS）+ 连接方式/系统两个小标签；
- 预览：H.264 → WebCodecs；底部悬浮胶囊（`◀ ○ □ │ 📷`）；顶部设备下拉、清晰度、旋转、更多；
- **不做**分辨率/网速等元数据栏；v1 **不做**文字输入框；
- 断开连接放在设备下拉菜单里并二次确认。

## 6. 不要做的事

- 不要用 `ctx.connection.rpc.handle()`（web 组合下会失败），必须 `webServer.register` + `connection.admit`；
- 不要引入构建工具/打包器/运行时依赖（手写 ModuleLoader bundle 是刻意设计）；
- 不要在 `inject` 里放可选服务（用 `ctx.get` 宽松读取）；
- 不要把真实设备截图提交进仓库（docs 截图用 /tmp 合成素材 + `render-test.mjs` 生成）；
- 不要提交 `node_modules/`、`*.tgz`、临时脚本、密钥。

## 7. 版本与发布

- 版本号语义化；**发布只由 `v*` tag 触发**，禁止手动 `npm publish`（首次 0.1.0 例外，已完成）；
- 每个版本必须更新 `CHANGELOG.md`（`## <semver> — <YYYY-MM-DD>`），Release 正文由它抽取；
- npm Trusted Publishing（OIDC）已配置：PonyDevAI/dsh-phone + workflow `release.yml`，发布免 2FA；
- 提交信息用 Conventional Commits；作者使用全局 git config，不写 AI 署名。
