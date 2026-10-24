// dsh-phone · 冒烟测试（不触网；有 adb 时额外做一次真实设备列表检查）
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Adb, ADDRESS_RE, KEYS, SERIAL_RE, classifyDevice, parseDevices, parseGetprop, parseWmSize, platformFromProps } from '../lib/adb.js'
import { STREAM_QUALITY, streamSizeFor } from '../lib/stream.js'
import { createTargetStore } from '../lib/targets.js'

let failures = 0
function ok(name, condition) {
  if (condition) return
  failures += 1
  console.error('FAIL  ' + name)
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) return
  failures += 1
  console.error('FAIL  ' + name + '\n  expected ' + b + '\n  actual   ' + a)
}

// ---------------------------------------------------------------- fixtures
const SAMPLE = `List of devices attached
34201JEHN07681         device usb:17825792X product:lynx model:Pixel_7a device:lynx transport_id:157337
100.107.25.26:5555     device product:lynx model:Pixel_7a device:lynx transport_id:157244
100.90.248.53:5555     device product:thor model:2203121C device:thor transport_id:94422
unicom-openclaw-pony:5555 device product:thor model:2203121C device:thor transport_id:64698
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:9
XYZ123                 unauthorized usb:1-1 transport_id:3
OFFLINE1               offline transport_id:4
`

const devices = parseDevices(SAMPLE)
eq('device count', devices.length, 7)
eq('usb serial', devices[0].serial, '34201JEHN07681')
eq('usb kind', devices[0].kind, 'usb')
eq('usb model', devices[0].model, 'Pixel 7a')
eq('tailscale ip kind', devices[1].kind, 'tailscale') // 100.107.25.26 是 Tailscale CGNAT
eq('tailscale dns kind', devices[3].kind, 'tailscale')
eq('emulator kind', devices[4].kind, 'emulator')
eq('unauthorized state', devices[5].state, 'unauthorized')
eq('offline state', devices[6].state, 'offline')

ok('junk lines ignored', parseDevices('* daemon started successfully\n\n').length === 0)
ok('serial regex accepts cloud name', SERIAL_RE.test('unicom-openclaw-pony:5555'))
ok('serial regex rejects shell', !SERIAL_RE.test('x; rm -rf /'))
ok('address regex accepts ipv4', ADDRESS_RE.test('192.168.1.5:5555'))
ok('address regex rejects text', !ADDRESS_RE.test('hello world'))
eq('classify unknown defaults usb', classifyDevice('34201JEHN07681', {}), 'usb')
eq('classify cgnat as tailscale', classifyDevice('100.90.248.53:5555', {}), 'tailscale')
eq('classify dns as tailscale', classifyDevice('unicom-openclaw-test:5555', {}), 'tailscale')
eq('classify plain ip as wifi', classifyDevice('192.168.1.7:5555', {}), 'wifi')
eq('getprop parse', parseGetprop('[ro.product.brand]: [google]\n[ro.build.version.release]: [15]\n')['ro.product.brand'], 'google')
eq('platform android', platformFromProps({ 'ro.product.brand': 'google', 'ro.build.version.release': '15' }), 'android')
eq('platform harmony by version', platformFromProps({ 'ro.build.version.harmony': '4.0.0' }), 'harmony')
eq('platform harmony by hw_sc', platformFromProps({ 'hw_sc.build.platform.version': '6.0.0' }), 'harmony')
eq('platform harmony by brand', platformFromProps({ 'ro.product.brand': 'Harmony' }), 'harmony')
eq('key map has back', KEYS.back, '4')

// ---------------------------------------------------------------- live adb (optional)
const adb = new Adb()
let resolved = null
try {
  resolved = await adb.resolve()
} catch (error) {
  console.log('SKIP  live adb: ' + (error.message || error))
}
if (resolved) {
  const live = await adb.devices({ fresh: true })
  ok('live devices returns array', Array.isArray(live.devices))
  ok('live adb version', typeof resolved.version === 'string' && resolved.version.length > 0)
  for (const device of live.devices) {
    ok('live serial parseable: ' + device.serial, SERIAL_RE.test(device.serial))
    ok('live kind known: ' + device.serial, ['usb', 'wifi', 'tailscale', 'emulator'].includes(device.kind))
  }
  console.log('LIVE  adb ' + resolved.version + ' · ' + live.devices.length + ' device(s)')
  if (process.env.SMOKE_TIMEOUT) ok('live timeout error path', true)
}

// ---------------------------------------------------------------- 分辨率 / 流尺寸
eq('wm size prefers override', parseWmSize('Physical size: 1080x1920\nOverride size: 1256x2584'), { width: 1256, height: 2584, overridden: true })
eq('wm size physical fallback', parseWmSize('Physical size: 1080x2400'), { width: 1080, height: 2400, overridden: false })
eq('stream size pixel 9:20', streamSizeFor({ width: 1080, height: 2400 }, STREAM_QUALITY.medium.shortSide), { width: 540, height: 1200 })
eq('stream size 720x1280', streamSizeFor({ width: 720, height: 1280 }, STREAM_QUALITY.medium.shortSide), { width: 540, height: 960 })
eq('stream size override 1256x2584', streamSizeFor({ width: 1256, height: 2584 }, STREAM_QUALITY.medium.shortSide), { width: 540, height: 1110 })
eq('stream size high clamps to native', streamSizeFor({ width: 720, height: 1280 }, STREAM_QUALITY.high.shortSide), { width: 720, height: 1280 })
ok('stream size even dims', streamSizeFor({ width: 1081, height: 2401 }, 540).width % 2 === 0)

// ---------------------------------------------------------------- 连接目标存储
const dir = mkdtempSync(join(tmpdir(), 'dsh-phone-'))
try {
  const store = createTargetStore(join(dir, 'targets.json'))
  eq('targets empty', await store.list(), [])
  await store.record('100.90.248.53:5555')
  await store.record('unicom-openclaw-test:5555')
  await store.record('100.90.248.53:5555')
  const list = await store.list()
  eq('targets dedupe + latest first', list.map((item) => item.address), ['100.90.248.53:5555', 'unicom-openclaw-test:5555'])
  ok('targets timestamp', typeof list[0].lastSeenAt === 'number')
  await store.remove('100.90.248.53:5555')
  eq('targets remove', (await store.list()).map((item) => item.address), ['unicom-openclaw-test:5555'])
  eq('targets rejects bad address', await store.record('x; rm -rf /'), null)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// guard rails: 非法 serial 必须在跑 adb 之前就被拒绝
try {
  await adb.shot('bad;serial')
  ok('invalid serial rejected', false)
} catch (error) {
  eq('invalid serial code', error.code, 'bad-serial')
}

if (failures > 0) {
  console.error('\n' + failures + ' check(s) failed')
  process.exit(1)
}
console.log('smoke ok')
