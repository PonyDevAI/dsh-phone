// dsh-phone · 离线 UI 预览
// 1) 用真实截图 + 假 fetch/ctx 渲染客户端组件到 /tmp/dsh-phone-render.html
// 2) 如果本机有 Chrome，顺手截一张 /tmp/dsh-phone-render.png
// 用法：node scripts/render-test.mjs [screenshot.png]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
const shotPath = process.argv[2] || '/tmp/dsh-phone-shot.png'
const shotBase64 = existsSync(shotPath) ? readFileSync(shotPath).toString('base64') : ''
const streamPath = process.argv[3] || '/tmp/p1-video.h264'
const streamBase64 = existsSync(streamPath) ? readFileSync(streamPath).toString('base64') : ''

const DEVICES = [
  { serial: '34201JEHN07681', state: 'device', kind: 'usb', model: 'Pixel 7a', product: 'lynx', device: 'lynx', transportId: '157337' },
  { serial: '100.107.25.26:5555', state: 'device', kind: 'tailscale', model: 'Pixel 7a', product: 'lynx', device: 'lynx', transportId: '157244' },
  { serial: '100.90.248.53:5555', state: 'device', kind: 'tailscale', model: '2203121C', product: 'thor', device: 'thor', transportId: '94422' },
  { serial: 'unicom-openclaw-pony:5555', state: 'device', kind: 'tailscale', model: '2203121C', product: 'thor', device: 'thor', transportId: '64698' },
  { serial: 'unicom-openclaw-test:5555', state: 'device', kind: 'tailscale', model: '2203121C', product: 'thor', device: 'thor', transportId: '91206' },
]

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>booting</title>
<style>
  html,body{margin:0;background:#ececee;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#17171a}
  .wrap{width:1160px;margin:0 auto;padding:20px}
  .head{height:52px;display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e5e5e8;border-radius:12px;padding:0 14px;margin-bottom:16px}
  .head .t{font-size:13.5px;font-weight:600}
  .head .sub{font-size:12px;color:#9a9aa1}
  .cols{display:flex;gap:16px}
  .panel{width:540px;height:812px;background:#fff;border:1px solid #e5e5e8;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .strip{height:44px;flex:none;display:flex;align-items:center;gap:6px;padding:0 8px;border-bottom:1px solid #e9e9ec}
  .tab{height:28px;border-radius:8px;background:#f4f4f5;display:flex;align-items:center;gap:6px;padding:0 8px;font-size:12.5px;font-weight:500}
  .tab .x{color:#9a9aa1;font-size:12px}
  .plus{margin-left:2px;color:#9a9aa1;font-size:15px}
  #rootA,#rootB{flex:1;min-height:0}
  .cap{font-size:11px;color:#9a9aa1;margin:0 0 6px 2px}
</style>
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
</head><body>
<div class="wrap">
  <div class="head"><span class="t">手机插件：右侧 adb 预览</span><span class="sub">· 3 个会话</span><span style="flex:1"></span><span id="headerRoot"></span></div>
  <div class="cols">
    <div><div class="cap">A · 设备列表</div><div class="panel"><div class="strip"><div class="tab">手机 <span class="x">×</span></div><span class="plus">+</span></div><div id="rootA"></div></div></div>
    <div><div class="cap">B · 预览画面</div><div class="panel"><div class="strip"><div class="tab">手机 <span class="x">×</span></div><span class="plus">+</span></div><div id="rootB"></div></div></div>
  </div>
</div>
<script>
window.__ModuleLoader__ = { load: (def) => { window.__DEF__ = def } }
window.onerror = function (message) { document.title = 'ERR ' + message }
window.addEventListener('unhandledrejection', function (event) { document.title = 'REJ ' + (event.reason && event.reason.message || event.reason) })
</script>
<script>if (location.search.indexOf('nostream') >= 0) { window.VideoDecoder = undefined }</script>
<script id="client-src">${CLIENT.replace(/<\/script>/g, '<\\/script>')}</script>
<script>
const SHOT = ${JSON.stringify(shotBase64)}
const STREAM = ${JSON.stringify(streamBase64)}
const DEVICES = ${JSON.stringify(DEVICES)}
function bytes() {
  if (!SHOT) return new Uint8Array([137, 80, 78, 71])
  const bin = atob(SHOT)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}
window.fetch = async function (url, init) {
  const target = String(url)
  const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  if (target.endsWith('health')) return json({ ok: true, value: { adb: { bin: 'adb', version: '1.0.41' }, devices: DEVICES.length } })
  if (target.endsWith('devices')) return json({ ok: true, value: { devices: DEVICES, at: Date.now() } })
  if (target.endsWith('screen-info')) return json({ ok: true, value: { width: 1080, height: 2400 } })
  if (target.endsWith('stream')) {
    if (location.search.indexOf('streamfail') >= 0) return json({ ok: false, error: { message: '未知接口: stream' } })
    if (!STREAM) return json({ ok: false, error: { message: 'no stream fixture' } })
    const bin = atob(STREAM)
    const data = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) data[i] = bin.charCodeAt(i)
    const chunkSize = 8192
    const stream = new ReadableStream({
      async start(controller) {
        for (let offset = 0; offset < data.length; offset += chunkSize) {
          controller.enqueue(data.slice(offset, offset + chunkSize))
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        // 保持流不关闭，模拟真实 screenrecord 持续输出
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'video/h264' } })
  }
  if (target.endsWith('shot')) return new Response(bytes(), { status: 200, headers: { 'content-type': 'image/png' } })
  if (target.endsWith('disconnect')) return json({ ok: true, value: {} })
  if (target.endsWith('targets')) return json({ ok: true, value: { targets: [{ address: 'unicom-openclaw-new:5555', lastSeenAt: Date.now() }, { address: '192.168.1.50:5555', lastSeenAt: Date.now() }] } })
  if (target.endsWith('targets/remove')) return json({ ok: true, value: { removed: true } })
  if (target.endsWith('input') || target.endsWith('connect')) return json({ ok: true, value: {} })
  return json({ ok: false, error: { message: 'unstubbed ' + target } })
}

const def = window.__DEF__
const React = window.React
const ReactDOM = window.ReactDOM
function requireStub(name) {
  if (name === 'react') return React
  if (name === 'react-dom') return ReactDOM
  throw new Error('unknown require: ' + name)
}
const mod = def.factory(requireStub)
const captured = {}
let dict = {}
const ctx = {
  effect(fn) { try { const dispose = fn(); return typeof dispose === 'function' ? dispose : function () {} } catch (error) { console.error('effect failed', error) } },
  locale: {
    register(namespace, dictionaries) { dict = dictionaries.zh || {}; return function () {} },
    bind() { return (key) => dict[key] || key },
  },
  slots: {
    inject(slot, register) {
      try {
        const result = register()
        if (result && result.comp) captured[slot] = result
      } catch (error) { console.error('slot register failed', slot, error) }
      return function () {}
    },
    register(options, comp) { return { options, comp } },
  },
  sidebarRight: {
    openTab() { window.__OPENED = (window.__OPENED || 0) + 1 },
    float(tabId, rect) { window.__FLOAT__ = { tabId, rect } },
  },
  sidebarRightTabs: { register() { return function () {} } },
}
mod.apply(ctx)

const t = (key) => dict[key] || key
function renderSlot(slot, extra) {
  const entry = captured[slot]
  if (!entry) throw new Error('slot not captured: ' + slot)
  const injected = entry.options.inject ? entry.options.inject(extra.sessionId) : {}
  const props = Object.assign({ t, sessionId: 'demo' }, injected, extra)
  return React.createElement(entry.comp, props)
}
const tabInfo = { tab: { visible: true, navigation: { params: {} }, id: 'tab-1' }, panel: { id: 'pane-1' }, sidebar: { fullscreen: false, expanded: true } }
ReactDOM.createRoot(document.getElementById('headerRoot')).render(renderSlot('conversation.session.header.utilities', { sessionId: 'demo' }))
ReactDOM.createRoot(document.getElementById('rootA')).render(renderSlot('sidebar.right.pane.tab', { sessionId: 'demo', useTabInfo: () => tabInfo }))
ReactDOM.createRoot(document.getElementById('rootB')).render(renderSlot('sidebar.right.pane.tab', { sessionId: 'demo', useTabInfo: () => tabInfo }))

setTimeout(function () {
  const row = document.querySelector('#rootB .dph-row')
  if (row) row.click()
}, 350)
setTimeout(function () {
  if (location.hash !== '#float' && location.hash !== '#diag') document.title = 'ready slots=' + Object.keys(captured).join(',')
}, 2500)

// #fallback：流接口报错时应自动回退截图轮询
if (location.hash === '#fallback') {
  setTimeout(function () {
    const img = document.querySelector('#rootB .dph-screen img')
    const overlay = document.querySelector('#rootB .dph-overlay')
    const root = document.querySelector('#rootB .dph-root')
    document.title = 'fallback img=' + (img ? img.naturalWidth + 'x' + img.naturalHeight : 'none')
      + ' overlay=' + (overlay ? (overlay.innerText || '').replace(/\s+/g, ' ').slice(0, 30) : 'none')
      + ' root=' + (root ? 'y' : 'n')
  }, 4500)
}

// #stream：用真实 H.264 fixture 走一遍「fetch 流 → WebCodecs → canvas」
if (location.hash === '#stream') {
  setTimeout(function () {
    const canvas = document.querySelector('#rootB canvas')
    let filled = false
    let size = null
    if (canvas) {
      size = canvas.width + 'x' + canvas.height
      try {
        const ctx = canvas.getContext('2d')
        const data = ctx.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64)).data
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i+1] + data[i+2] > 40) { filled = true; break }
        }
      } catch (error) {
        size = 'readback-error ' + error
      }
    }
    const root = document.querySelector('#rootB .dph-root')
    const stage = document.querySelector('#rootB .dph-stage')
    const screen = document.querySelector('#rootB .dph-screen')
    document.title = 'stream canvas=' + size + ' filled=' + filled
      + ' root=' + (root ? 'y' : 'n') + ' stage=' + (stage ? 'y' : 'n')
      + ' screenChildren=' + (screen ? screen.children.length : 'n')
      + ' text=' + (root ? root.innerText.replace(/\s+/g, ' ').slice(0, 60) : '')
  }, 4500)
}

// #diag：模拟「⋯ → adb 诊断」，验证诊断面板能打开
if (location.hash === '#diag') {
  setTimeout(function () {
    const buttons = document.querySelectorAll('#rootB .dph-bar .dph-ibtn')
    const more = buttons[buttons.length - 1]
    if (more) more.click()
    setTimeout(function () {
      const items = [...document.querySelectorAll('#rootB .dph-menu .dph-row')]
      const target = items.find(function (node) { return (node.textContent || '').indexOf('诊断') >= 0 })
      if (target) target.click()
      setTimeout(function () {
        const pre = document.querySelector('#rootB .dph-diag-pre')
        document.title = 'diag ' + (pre ? pre.textContent.split(String.fromCharCode(10)).join(' | ') : 'missing')
      }, 400)
    }, 250)
  }, 1200)
}

// #float：模拟「⋯ → 浮窗打开」，验证 rect 计算与注入链路
if (location.hash === '#float') {
  setTimeout(function () {
    const buttons = document.querySelectorAll('#rootB .dph-bar .dph-ibtn')
    const more = buttons[buttons.length - 1]
    if (more) more.click()
    setTimeout(function () {
      const items = [...document.querySelectorAll('#rootB .dph-menu .dph-row')]
      const target = items.find(function (node) { return (node.textContent || '').indexOf('浮窗') >= 0 })
      if (target) target.click()
      setTimeout(function () {
        document.title = 'float ' + JSON.stringify(window.__FLOAT__ || null)
      }, 400)
    }, 250)
  }, 1200)
}
</script>
</body></html>`

const outHtml = '/tmp/dsh-phone-render.html'
writeFileSync(outHtml, html)
console.log('html  ' + outHtml)

const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
const chrome = chromeCandidates.find((candidate) => existsSync(candidate))
if (!chrome) {
  console.log('chrome not found; open the html manually')
  process.exit(0)
}
const outPng = '/tmp/dsh-phone-render.png'
try {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--hide-scrollbars',
      '--user-data-dir=/tmp/dsh-phone-chrome',
      '--force-device-scale-factor=1',
      '--window-size=1200,940',
      '--virtual-time-budget=6000',
      '--screenshot=' + outPng,
      'file://' + outHtml,
    ],
    { stdio: 'ignore', timeout: 60000 },
  )
  console.log('png   ' + outPng)
} catch (error) {
  console.error('screenshot failed: ' + (error.message || error))
}
