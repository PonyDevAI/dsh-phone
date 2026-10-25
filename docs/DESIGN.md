# dsh-phone · 设计草案 v2

> 给 DeepSeek Harness Web 加一个「手机」：会话右上角手机图标 → 右侧栏设备列表 → 点一台设备，右侧只看画面、可以直接点按。
> 参考 Codex Mobile Dev 的右侧设备面板：**顶上只有一行「设备下拉 + 几个图标」，下面整块留给设备画面**。
> 本文是布局、命名与技术方案，**尚未开始写代码**。

原型（离线 HTML，假数据，可用浏览器直接打开）：[`docs/mockups/mockup.html`](mockups/mockup.html)

---

## 1. 结论先说

| 问题 | 结论 |
|---|---|
| 插件名 | **`dsh-phone`**（npm 上未被占用，已查；repo `PonyDevAI/dsh-phone`） |
| tab 标题 / kind | 「手机」/ `phone` |
| 容器 | DSH 原生右侧栏（`@deepseek-ai/dsh-client-ui-sidebar-right`），不自己造悬浮层 |
| 入口 | 会话头部工具区（`conversation.session.header.utilities`）手机图标，带在线设备数角标 |
| 面板内容 | 状态 A：设备列表；状态 B：设备画面（真实机身 bezel，只有画面 + 顶部工具条） |
| 不要的东西 | ❌ 分辨率 / 网速 / fps 等元数据栏；❌ 底部文字输入框；❌ 画面旁边任何说明文字 |
| 展开/关闭 | 白送：点图标自动展开；tab 条右侧是全屏/收起；DSH 还支持把 tab 拖出来变浮窗 |
| 传输 | P0 轮询 `adb exec-out screencap -p`（1–2 fps，够看和点）；P1 `screenrecord --output-format=h264` + WebCodecs 做到 ~30 fps |
| 以后 hdc / iOS | Host 侧抽 `PhoneTransport` 接口，adb 先实现；hdc / iOS 后加，UI 不变 |

参考：

- Codex Mobile Dev（Callstack）：面板一行工具条（设备下拉 + Home / App Switcher / Screenshot / Select），下面是真实设备 bezel，没有元数据栏、没有输入框。[博客](https://www.callstack.com/blog/introducing-mobile-dev-full-mobile-dev-tooling-right-in-your-codex-app) · [GitHub](https://github.com/callstackincubator/mobile-dev)
- Claude Code desktop 的 preview：标题栏极简、内容占满，控制项收在顶栏。[博客](https://claude.com/blog/preview-review-and-merge-with-claude-code)

---

## 2. 布局

### 2.1 整页位置（1440×900）

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ dsh web                                                                       │
├──────────────┬─────────────────────────────────────────────┬──────────────────┤
│ 左侧栏 268px │ 会话区                                       │ 右侧栏 540px      │
│              │ ┌─────────────────────────────────────────┐ │ ┌──────────────┐ │
│ 新会话        │ │ 会话标题 · n 个会话  [📱5] [⋯] [◧收起]   │ │ │ 手机 × │+│⧉│ │ │
│ 搜索          │ ├─────────────────────────────────────────┤ │ ├──────────────┤ │
│ ● 会话1       │ │                                         │ │ │ [Pixel 7a ▾] │ │
│ ● 会话2       │ │            消息流                        │ │ │   ← ○ □ 📷 ⋯│ │
│ ● 会话3       │ │                                         │ │ ├──────────────┤ │
│ ...           │ │                                         │ │ │              │ │
│              │ ├─────────────────────────────────────────┤ │ │   设备画面    │ │
│ 模型用量 ¥117 │ │ 输入框                    [↑]            │ │ │  （灰底+机身） │ │
│ 设置          │ └─────────────────────────────────────────┘ │ │              │ │
└──────────────┴─────────────────────────────────────────────┴──────────────────┘
```

要点：

- 手机图标在**会话头部右侧工具区**（「⋯ 更多」左边），带设备数角标；右侧栏收起时它仍然在。
- 右侧栏顶部是 DSH 原生 tab 条（`手机 ×`、`+`、分屏、全屏、收起），下面是**我们的一行工具条**。
- 工具条只有一个设备下拉 + 4–5 个图标按钮，**没有第二行、没有右侧信息列、没有底部输入条**。

### 2.2 状态 A：设备列表

```
[ 选择设备 ▾ ]                              [刷新] [＋]
──────────────────────────────────────────────────────
已连接
  ▢ Pixel 7a      [USB]     SERIAL0123456789AB      ›
  ▢ Pixel 7a      [Wi-Fi]   100.64.0.11:5555        ›
  ▢ 小米 13       [thor]    100.64.0.12:5555        ›
云手机
  ☁ 云手机 A                node-a.example-tailnet.ts.net:5555  ›
  ☁ 云手机 B                node-b.example-tailnet.ts.net:5555  ›
──────────────────────────────────────────────────────
● 5 台在线
```

- 每行只有：设备图标 + 状态点、型号 + 传输标签、serial、右箭头。没有分辨率、没有电量、没有网速。
- 分组只有「已连接 / 云手机」，别的不铺开；状态点：绿 `device`、黄 `unauthorized`（提示手机上点允许）、灰 `offline`。
- 点行 = 选中并切到状态 B；下拉里也是同一份列表（Codex 的 device dropdown 就是这样）。
- 「＋」弹一个小输入框：`adb connect <ip>:<port>`（P1 再加无线调试配对码）。

### 2.3 状态 B：设备画面

```
[ Pixel 7a ▾ ]                       [←] [○] [□] [📷] [⋯]
──────────────────────────────────────────────────────
                 ┌──────────────────┐
                 │   9:41    5G 86% │
                 │    ●             │
                 │  ▢ ▢ ▢ ▢         │
                 │  ▢ ▢ ▢ ▢         │
                 │                  │
                 │                  │
                 │  ▢ ▢ ▢ ▢  dock   │
                 └──────────────────┘
                   灰底 #f2f2f4
```

- 画面区域是**灰底 + 设备机身**（圆角、侧键、挖孔），只有屏幕，没有别的。
- 顶栏：设备下拉（换设备）、返回、主页、多任务、截图、`⋯`（电源、旋转、重新连接、断开、复制 serial）。
- 点画面 = `tap`，拖拽 = `swipe`；长按可以后加。没有文字输入（v1 明确不做）。
- 加载 / 断线 / 报错不占额外一栏：画面区域中央一行小字 + 重试按钮，或在顶栏图标变灰。
- 点 `⋯ → 设备列表`（或点 tab 上的手机图标）回到状态 A。

### 2.4 为什么不做这些

- **不做右侧元数据列**：Codex / Claude 的面板都是「屏幕就是主角」，分辨率、网速、fps 这类信息开发时偶尔才看，放进去只会挤小画面。
- **不做文字输入框**：`adb shell input text` 只支持 ASCII，中文要装 ADBKeyboard；真正输入靠电脑键盘映射（UHID）才有意义，v1 先不做，避免一个用不了的中文输入框。
- **不自造悬浮层**：DSH 右侧栏自带 push/fullscreen、折叠、宽度拖拽、拖出浮窗、分屏。自己画一层等于全部重写。

**已知限制**：右侧栏是 per-session 的，没有会话的页面（新建页、插件页）不显示手机图标；手机面板不跨会话常驻。

---

## 3. 技术方案

### 3.1 包结构（与 dsh-model-usage 同构）

```
dsh-phone/
├── lib/index.js        Host：Cordis 插件、/phone/* RPC、adb 进程管理
├── lib/adb.js          adb 封装（execFile、超时、设备白名单、串行化）
├── lib/transport.js    PhoneTransport 接口 + adb 实现（hdc/ios 后加）
├── lib/client.js       浏览器：tab 类型、列表/预览组件、轮询、i18n
├── cordis.patch.yml    bundle 补丁（插入 phone 行）
├── docs/               本文 + 截图
└── scripts/smoke.mjs   假 adb 的冒烟测试
```

零运行时依赖、ESM、手写 `window.__ModuleLoader__.load` bundle、无构建步骤 —— 照 `dsh-model-usage` 的模板（它是现成活样例）。

### 3.2 package.json 关键字段

```json
{
  "name": "dsh-phone",
  "engines": { "dsh": ">=0.2.0-rc.2 <0.3.0" },
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-locale"
      ],
      "external": ["@deepseek-ai/dsh-client-ui-primitives"]
    }
  }
}
```

### 3.3 Host 侧

`inject: ['connection', 'webServer']`，自己挂 `/phone` 前缀路由（**不要**用 `connection.rpc.handle()`，web 组合下会抛 without inject），每个请求过 `connection.admit(req)` 的 Host/Origin 围栏 + Cookie 认证。

| 路由 | 作用 |
|---|---|
| `POST /phone/health` | adb 是否存在、版本、设备数；UI 首屏判断「没装 adb」 |
| `POST /phone/devices` | `adb devices -l` 解析成 `{ serial, state, model, product, transport }` |
| `POST /phone/connect` | `adb connect <host:port>`（参数白名单校验） |
| `POST /phone/disconnect` | `adb disconnect <serial>` |
| `POST /phone/shot` | `adb -s <serial> exec-out screencap -p` → `image/png` 原始字节 |
| `POST /phone/input` | `tap` / `swipe` / `key`（返回、主页、多任务、电源）/ `rotate` |

安全：

- **serial 白名单**：每次 `shot` / `input` 前，serial 必须出现在最近一次 `adb devices` 结果里。
- 一律 `execFile('adb', [args...])`，不拼 shell；connect 地址用 `/^[A-Za-z0-9.\-_:]+:\d{1,5}$/` 校验。
- 每台设备一个 in-flight 信号量（截图重叠时丢弃上一帧）；超时：截图 5s、列表 5s、input 3s。
- 不暴露任意 `adb shell`。

### 3.4 Client 侧

```js
// 1) tab 类型（multiple：以后可以每台设备一个 tab）
ctx.sidebarRightTabs.register({
  id: 'dsh-phone', kind: 'phone', multiple: true, priority: 'builtin',
  title: () => t('title'),
  guide: [{ id: 'open', order: 30, title: () => t('title'), icon: PhoneIcon }],
})

// 2) tab 正文
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-phone' }, PhoneTabBody)

// 3) 会话头部手机图标
ctx.slots.register({
  name: 'conversation.session.header.utilities',
  id: 'phone', order: 10, locale: NS,
  inject: () => ({ open: () => ctx.sidebarRight.openTab('phone') }),
}, PhoneHeaderButton)
```

- 选中设备：`ctx.sidebarRight.openTab('phone', { params: { serial } })`；正文用 `useTabInfo().tab.navigation.params` 读取。
- 列表可见时 5s 刷新一次；预览可见时 500–800ms 拉一帧；`tab.visible === false` 或页面隐藏时暂停，`AbortController` 取消在途请求，`URL.revokeObjectURL` 回收上一帧。
- 点按：`pointerdown`/`pointerup` 距离 < 8px 且 < 300ms → tap，否则 swipe；坐标按截图实际像素换算（截图已是当前旋转方向）。
- 文案走 `ctx.locale.register`（zh/en），颜色只用 `--dsw-*` token，组件用官方 primitives。

### 3.5 传输演进

| 阶段 | 画面 | 代价 | 效果 |
|---|---|---|---|
| P0 | 轮询 `exec-out screencap -p` | ~1 天 | 1–2 fps，能看状态、能点按 |
| P1 | `screenrecord --output-format=h264 -`（分块 HTTP / SSE）→ WebCodecs 解 Annex-B | ~2–3 天 | 20–30 fps，延迟 ~150ms；不需要 scrcpy-server |
| P2 | 可选接 scrcpy-server | 更重 | 最接近 scrcpy 体验 |

P0 先落地；P1 只替换画面组件，tab / 列表 / 工具条 / 输入事件都不用动。

### 3.6 以后接 hdc / iOS

Host 侧定义 `PhoneTransport { id, list, connect, shot, input }`：

- adb：`adb devices -l` / `exec-out screencap` / `shell input`
- hdc（鸿蒙）：`hdc list targets` / `hdc shell snapshot_display` + `hdc file recv` / `hdc shell uitest uiInput tap`
- iOS：`idb` 或 WDA HTTP（现有 `dsh-mobile-control` 是 WDA 路线）

列表行加传输徽标，其他 UI 不变。

---

## 4. 开发步骤

1. **骨架**：`~/deepseek/plugins/dsh-phone` 新建独立 git repo（远程 `PonyDevAI/dsh-phone`），照 model-usage 起 `package.json` / `cordis.patch.yml` / 空 `lib/*.js`；`dsh plugin --profile web add link:<路径>` 挂进 web profile，重启 dsh web 验证空插件能加载。
2. **Host P0**：`adb.js` + `/phone/{health,devices,connect,shot,input}`，假 adb 冒烟 + 真机（本机 5 台在线）逐条验证；覆盖未授权、离线、设备消失、超时。
3. **Client 列表**：tab 类型 + 头部图标 + 状态 A；`test-render.html` 离线验组件，0 控制台错误。
4. **Client 预览**：状态 B（截图轮询 + 点按/滑动 + 顶栏工具条 + 机身 bezel），Pixel 7a USB 与云手机各校准一次坐标，横竖屏都试。
5. **打包**：`npm pack --dry-run`、README / CHANGELOG、tag 发布（`dsh-phone` 名字可用）。
6. **P1**：H.264 流（screenrecord + WebCodecs）；P2：hdc / iOS transport、agent 工具。

验收标准：

- 点手机图标右侧栏展开，列表与 `adb devices -l` 一致；
- 点设备看到画面，点画面手机有反应且坐标不偏（横竖屏）；
- 拔线/断网 3s 内显示离线并可重试，不白屏；
- 切换会话、折叠右侧栏、刷新页面不崩；未认证请求 401。

---

## 5. 还需要你拍板的 2 件事

1. **P0 就够**（1–2 fps 截图）还是直接上 H.264 30fps？
2. 设备多时：默认「一个 tab 内切换」（本文）还是「每台设备一个 tab」？

（图标位置 = 会话头部工具区、名字 = `dsh-phone`、无元数据列、无输入框，已按你的意思定下。）


## 多平台 transport（0.4.0）

```
/phone/*  ── resolveDevice(serial) ──┬── adb       Android 真机 / 云手机（H.264 screenrecord）
                                     ├── simctl    iOS 模拟器（截图；idb 提供 H.264 + HID）
                                     ├── emulator  HarmonyOS 模拟器（DevEco Emulator CLI）
                                     └── hdc       HarmonyOS 真机（snapshot_display + uitest）
```

- **iOS**：只支持模拟器。生命周期/创建走公开 `xcrun simctl`；实时画面与点击/输入走 `idb`
  （Meta FBSimulatorControl，Claude Code Desktop 内部也是 CoreSimulator/SimulatorKit 私有栈）。
  idb 的 `video-stream --format h264` 输出 Annex-B，直接复用客户端的 WebCodecs 管线；
  `idb describe` 的 `screen_dimensions.density` 用于像素 → point 坐标换算。
- **HarmonyOS 模拟器**：`Emulator -list/-create/-start/-stop/-delete/-screenshot/-click/-slide/-rotation/-power`；
  按键与文字借道 hdc `uitest uiInput`（模拟器没有对应 CLI）。
- **HarmonyOS 真机**：`hdc list targets` + `snapshot_display` + `uitest uiInput`；没有 screenrecord，只能截图轮询。
- **物理 iPhone / iPad 不支持**：Apple 没有公开投屏/HID 注入 API（Claude 同样只做模拟器；
  Codex 用 Xcode 27 CoreDevice 私有 HEVC + UniversalHID，不在本项目范围）。
