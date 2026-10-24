# 贡献指南

## 环境要求

- Node.js 24+
- 已安装 DSH（`@deepseek-ai/dsh` ≥ 0.2.0-rc.2）
- 本机有 `adb`（Android platform-tools），设备已授权 USB 调试
- 本地开发无需构建（ESM + 手写 ModuleLoader bundle）

## 本地开发

```bash
# 1. 链接安装到当前 web profile
dsh plugin --profile web add link:$PWD

# 2. Host 侧（lib/index.js、lib/adb.js、lib/transport.js）改完必须重启 dsh web
#    注意：重启会断开正在进行的会话，按你的使用习惯找时机
launchctl kickstart -k gui/$(id -u)/local.deepseek-harness.web

# 3. Client 侧（lib/client.js）改完刷新页面即可（⌘⇧R）
```

离线 UI 验证（不依赖宿主，也不需要会话）：

```bash
# 先准备一张真实截图
adb -s <serial> exec-out screencap -p > /tmp/dsh-phone-shot.png
npm run test:ui          # 输出 /tmp/dsh-phone-render.png
open /tmp/dsh-phone-render.html

# 流链路（H.264 → WebCodecs → canvas）：先录一段真实 H.264，再看 #stream 状态
adb -s <serial> exec-out screenrecord --output-format=h264 --time-limit=5 --size=540x1200 - > /tmp/p1-video.h264
node scripts/render-test.mjs /tmp/dsh-phone-shot.png /tmp/p1-video.h264
open '/tmp/dsh-phone-render.html#stream'   # canvas 有画面
node scripts/render-test.mjs --help >/dev/null 2>&1 || true
```

## 提交前检查

```bash
npm run check     # 语法 + i18n 键一致性
npm run smoke     # devices 解析 / 白名单 / 真机（无 adb 时自动 SKIP）
npm pack --dry-run
```

## 约定

- 只用 `execFile` + 参数数组，不拼 shell；新增命令必须进白名单。
- serial 必须先过 `adb devices` 列表校验。
- 不新增运行时依赖；不引入构建工具。
- UI 颜色只用 `--dsw-*` token，文案走 zh/en 字典（`scripts/check-i18n.mjs` 会拦）。
- 不做分辨率/网速等元数据栏，不做文字输入框（v1 范围）。
- Conventional Commits：`feat:` / `fix:` / `docs:` / `ci:` / `chore:` / `refactor:`；不写 AI 署名。
