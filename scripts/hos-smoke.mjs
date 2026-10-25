// dsh-phone · 鸿蒙冒烟测试（Emulator CLI + hdc）
// 只读：list / imageList / screenshot / screenInfo + 参数校验；绝不执行 click / slide / key / power 等改 UI 的操作。
import { HarmonyEmulator, HarmonyHdc, HDC_SERIAL_RE, TEXT_RE, isJpeg, isPng, normalizeDeviceType, normalizeEmulatorName, parseEmulatorList, parseHdcTargets, parseImageList, parseJpegSize, parsePngSize, parseSnapshotSize } from '../lib/hos.js'

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
async function errorCode(task) {
  try {
    await task()
    return '(no-error)'
  } catch (error) {
    return error.code || '(no-code)'
  }
}

// ---------------------------------------------------------------- fixtures
const EMULATOR_JSON = JSON.stringify(
  [
    {
      name: 'Test Phone',
      isRunning: 'true',
      deviceType: 'phone',
      deviceModel: 'PHEMU-FD00',
      productModel: 'Test Phone',
      'hw.lcd.single.width': '1080',
      'hw.lcd.single.height': '2400',
      'os.osVersion': 'HarmonyOS 7.0.0(26.0.0)',
    },
    {
      name: 'Test Fold',
      isRunning: 'false',
      deviceType: 'foldable',
      deviceModel: 'PHEMU-FD01',
      productModel: 'Test Fold',
      'hw.lcd.double.width': '2210',
      'hw.lcd.double.height': '2416',
      'os.osVersion': 'HarmonyOS 6.0.0(20)',
    },
    { name: '', isRunning: 'true' },
  ],
  null,
  2,
)
const emulatorList = parseEmulatorList(EMULATOR_JSON)
eq('emulator fixture count', emulatorList.length, 2)
eq('emulator serial is name', emulatorList[0].serial, 'Test Phone')
eq('emulator running state', emulatorList[0].state, 'device')
eq('emulator stopped state', emulatorList[1].state, 'offline')
eq('emulator platform', emulatorList[0].platform, 'harmony')
eq('emulator kind', emulatorList[0].kind, 'simulator')
eq('emulator transport', emulatorList[0].transport, 'emulator')
eq('emulator width', emulatorList[0].width, 1080)
eq('emulator height', emulatorList[0].height, 2400)
eq('emulator foldable double fallback', [emulatorList[1].width, emulatorList[1].height], [2210, 2416])
eq('emulator model', emulatorList[0].model, 'Test Phone')
eq('emulator osVersion', emulatorList[0].osVersion, 'HarmonyOS 7.0.0(26.0.0)')
ok('emulator parse rejects junk', (() => {
  try {
    parseEmulatorList('not json')
    return false
  } catch (error) {
    return error.code === 'emulator-parse'
  }
})())

const IMAGE_JSON = JSON.stringify(
  [
    {
      SoftWareVersion: '7.0.0.107',
      deviceType: 'phone',
      downloaded: 'true',
      osVersion: 'HarmonyOS 7.0.0(26.0.0)',
      releaseType: 'Release',
      upgradable: 'false',
    },
    {
      SoftWareVersion: '6.1.0.126',
      deviceType: 'phone',
      downloaded: 'false',
      osVersion: 'HarmonyOS 6.1.1(24)',
      releaseType: 'Release',
      upgradable: 'false',
    },
  ],
  null,
  2,
)
const imageList = parseImageList(IMAGE_JSON)
eq('image fixture count', imageList.length, 2)
eq('image downloaded bool', imageList[0].downloaded, true)
eq('image not downloaded bool', imageList[1].downloaded, false)
eq('image apiVersion parsed', imageList[0].apiVersion, '26.0.0')
eq('image softwareVersion', imageList[0].softwareVersion, '7.0.0.107')
eq('image deviceType', imageList[0].deviceType, 'phone')

const TARGETS_TEXT = '192.0.2.10:5555\t\tTCP\tConnected\tlocalhost\thdc\nSERIAL0123456789AB\t\tUSB\tConnected\tlocalhost\thdc\nOFFLINE1\t\tTCP\tOffline\tlocalhost\thdc\n[Empty]\n'
const targets = parseHdcTargets(TARGETS_TEXT)
eq('targets count', targets.length, 3)
eq('targets tcp state', targets[0].state, 'device')
eq('targets usb connection', targets[1].connection, 'USB')
eq('targets offline state', targets[2].state, 'offline')
ok('targets junk ignored', parseHdcTargets('[Empty]\n').length === 0)

const JPEG = Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x09, 0x60, 0x04, 0x38, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
])
ok('jpeg fixture signature', isJpeg(JPEG))
eq('jpeg fixture size', parseJpegSize(JPEG), { width: 1080, height: 2400 })
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(25)])
PNG.writeUInt32BE(13, 8)
PNG.write('IHDR', 12, 'ascii')
PNG.writeUInt32BE(1260, 16)
PNG.writeUInt32BE(2720, 20)
ok('png fixture signature', isPng(PNG))
eq('png fixture size', parsePngSize(PNG), { width: 1260, height: 2720 })
ok('png rejects jpeg', !isPng(JPEG))
eq('snapshot size uses last match', parseSnapshotSize('file type: jpeg, width: 100, height: 200\nwidth: 1260, height: 2720'), { width: 1260, height: 2720 })

eq('device type phone', normalizeDeviceType('phone'), 'Phone')
eq('device type foldable', normalizeDeviceType('Foldable'), 'Foldable')
eq('device type wide fold', normalizeDeviceType('wide fold'), 'WideFold')
ok('device type rejects junk', (() => {
  try {
    normalizeDeviceType('toaster')
    return false
  } catch (error) {
    return error.code === 'bad-device-type'
  }
})())
ok('emulator name accepts spaces', normalizeEmulatorName('Mate 60 Pro') === 'Mate 60 Pro')
ok('emulator name accepts chinese', normalizeEmulatorName('测试机 1') === '测试机 1')
ok('emulator name rejects path', (() => {
  try {
    normalizeEmulatorName('../x')
    return false
  } catch (error) {
    return error.code === 'bad-emulator-name'
  }
})())
ok('serial regex accepts cloud', HDC_SERIAL_RE.test('192.0.2.10:5555'))
ok('serial regex rejects shell', !HDC_SERIAL_RE.test('x; rm -rf /'))
ok('text regex accepts chinese', TEXT_RE.test('你好 世界'))
ok('text regex rejects semicolon', !TEXT_RE.test('a;rm -rf /'))
ok('text regex rejects substitution', !TEXT_RE.test('$(reboot)'))
ok('text regex rejects backtick', !TEXT_RE.test('`reboot`'))
ok('text regex rejects quote', !TEXT_RE.test("it's"))

// guard rails: 非法名 / serial 必须在跑命令之前就被拒绝
eq('emulator shot invalid name code', await errorCode(() => new HarmonyEmulator().shot('x/y')), 'bad-emulator-name')
eq('hdc shot invalid serial code', await errorCode(() => new HarmonyHdc().shot('bad;serial')), 'bad-serial')
eq('hdc input invalid serial code', await errorCode(() => new HarmonyHdc().input('bad;serial', { action: 'tap', x: 1, y: 1 })), 'bad-serial')
eq('hdc screen invalid serial code', await errorCode(() => new HarmonyHdc().screenInfo('bad;serial')), 'bad-serial')

// ---------------------------------------------------------------- live Emulator CLI
const emulator = new HarmonyEmulator()
let emulatorInfo = null
try {
  emulatorInfo = await emulator.resolve()
} catch (error) {
  console.log('SKIP  live emulator: ' + (error.message || error))
}
let emulatorScreen = null
if (emulatorInfo) {
  ok('live emulator version', typeof emulatorInfo.version === 'string' && emulatorInfo.version.length > 0)
  const list = await emulator.list()
  ok('live emulator list is array', Array.isArray(list))
  for (const device of list) {
    ok('live emulator serial: ' + device.serial, typeof device.serial === 'string' && device.serial.length > 0)
    ok('live emulator state: ' + device.serial, ['device', 'offline'].includes(device.state))
    ok('live emulator platform: ' + device.serial, device.platform === 'harmony')
    ok('live emulator kind: ' + device.serial, device.kind === 'simulator')
    ok('live emulator transport: ' + device.serial, device.transport === 'emulator')
    if (device.state === 'device') {
      ok('live emulator size: ' + device.serial, device.width > 0 && device.height > 0)
    }
  }
  const running = list.find((device) => device.state === 'device') || null
  const stopped = list.find((device) => device.state === 'offline') || null

  const images = await emulator.imageList()
  ok('live image list is array', Array.isArray(images))
  ok('live image list non-empty', images.length > 0)
  ok('live image list has downloaded', images.some((image) => image.downloaded))
  for (const image of images.slice(0, 20)) {
    ok('live image osVersion: ' + image.osVersion, typeof image.osVersion === 'string' && image.osVersion.length > 0)
    ok('live image downloaded boolean: ' + image.osVersion, typeof image.downloaded === 'boolean')
  }

  if (running) {
    const buffer = await emulator.shot(running.serial)
    ok('live emulator shot is PNG', isPng(buffer))
    const pngSize = parsePngSize(buffer)
    ok('live emulator shot size readable', Boolean(pngSize && pngSize.width > 0 && pngSize.height > 0))
    const screen = await emulator.screenInfo(running.serial)
    ok('live emulator screenInfo matches PNG', Boolean(pngSize && screen.width === pngSize.width && screen.height === pngSize.height))
    emulatorScreen = pngSize
    console.log(
      'LIVE  emulator ' +
        emulatorInfo.version +
        ' · ' +
        list.length +
        ' instance(s) · shot ' +
        (pngSize ? pngSize.width + 'x' + pngSize.height : '?') +
        ' PNG',
    )
    // 非破坏性校验：参数在发命令前就被拒，不会真的点
    eq('live emulator tap bad coordinate', await errorCode(() => emulator.input(running.serial, { action: 'tap', x: 'nope', y: 1 })), 'bad-coordinate')
    eq('live emulator unsupported action', await errorCode(() => emulator.input(running.serial, { action: 'nope' })), 'bad-action')
    eq('live emulator rotate bad direction', await errorCode(() => emulator.input(running.serial, { action: 'rotate', direction: 'up' })), 'bad-direction')
    // key/text 会先定位模拟器的 hdc serial，再在 hdc 层做参数校验；两者都在发命令前失败
    eq('live emulator key bad key', await errorCode(() => emulator.input(running.serial, { action: 'key', key: 'nope' })), 'bad-key')
    eq('live emulator text bad text', await errorCode(() => emulator.input(running.serial, { action: 'text', text: 'a;reboot' })), 'bad-text')
  } else {
    console.log('SKIP  live emulator screenshot: 没有运行中的模拟器')
  }
  if (stopped) {
    eq('live emulator stopped shot guard', await errorCode(() => emulator.shot(stopped.serial)), 'emulator-not-running')
  }
  eq('live emulator unknown start', await errorCode(() => emulator.start('dsh-smoke-nonexistent')), 'unknown-emulator')
  eq('live emulator unknown stop', await errorCode(() => emulator.stop('dsh-smoke-nonexistent')), 'unknown-emulator')
  eq('live emulator unknown remove', await errorCode(() => emulator.remove('dsh-smoke-nonexistent')), 'unknown-emulator')
  eq('live emulator create missing image', await errorCode(() => emulator.create({ name: 'dsh-smoke-noop', osVersion: 'HarmonyOS 0.0.0(0)' })), 'image-missing')
}

// ---------------------------------------------------------------- live hdc
const hdc = new HarmonyHdc()
let hdcInfo = null
try {
  hdcInfo = await hdc.resolve()
} catch (error) {
  console.log('SKIP  live hdc: ' + (error.message || error))
}
if (hdcInfo) {
  ok('live hdc version', typeof hdcInfo.version === 'string' && hdcInfo.version.length > 0)
  const devices = await hdc.list()
  ok('live hdc list is array', Array.isArray(devices))
  for (const device of devices) {
    ok('live hdc serial: ' + device.serial, HDC_SERIAL_RE.test(device.serial))
    ok('live hdc state: ' + device.serial, ['device', 'offline'].includes(device.state))
    ok('live hdc model: ' + device.serial, typeof device.model === 'string' && device.model.length > 0)
    ok('live hdc platform: ' + device.serial, device.platform === 'harmony')
    ok('live hdc kind: ' + device.serial, ['usb', 'wifi'].includes(device.kind))
    ok('live hdc transport: ' + device.serial, device.transport === 'hdc')
    ok('live hdc filters simulator: ' + device.serial, device.kind !== 'simulator')
  }
  const all = await hdc.list({ includeSimulators: true })
  const simulator = all.find((device) => device.kind === 'simulator') || null
  let hdcScreen = null
  if (simulator) {
    const buffer = await hdc.shot(simulator.serial)
    ok('live hdc shot is JPEG', isJpeg(buffer))
    const jpegSize = parseJpegSize(buffer)
    ok('live hdc shot size readable', Boolean(jpegSize && jpegSize.width > 0 && jpegSize.height > 0))
    const screen = await hdc.screenInfo(simulator.serial, { fresh: true })
    ok('live hdc screenInfo matches JPEG', Boolean(jpegSize && screen.width === jpegSize.width && screen.height === jpegSize.height))
    hdcScreen = jpegSize
    console.log(
      'LIVE  hdc ' +
        hdcInfo.version +
        ' · ' +
        devices.length +
        ' device(s) · emulator serial ' +
        simulator.serial +
        ' · shot ' +
        (jpegSize ? jpegSize.width + 'x' + jpegSize.height : '?') +
        ' JPEG',
    )
    eq('live hdc unsupported action', await errorCode(() => hdc.input(simulator.serial, { action: 'nope' })), 'bad-action')
    eq('live hdc bad text', await errorCode(() => hdc.input(simulator.serial, { action: 'text', text: 'a;reboot' })), 'bad-text')
    eq('live hdc empty text', await errorCode(() => hdc.input(simulator.serial, { action: 'text', text: '' })), 'bad-text')
    eq('live hdc bad coordinate', await errorCode(() => hdc.input(simulator.serial, { action: 'tap', x: 'nope', y: 1 })), 'bad-coordinate')
    eq('live hdc bad key', await errorCode(() => hdc.input(simulator.serial, { action: 'key', key: 'nope' })), 'bad-key')
    eq('live hdc inputText needs point', await errorCode(() => hdc.input(simulator.serial, { action: 'inputText', text: 'hi' })), 'bad-coordinate')
    eq('hdc finds emulator serial', await hdc.emulatorSerial(), simulator.serial)
    if (emulatorScreen && hdcScreen) {
      ok('live emulator/hdc screenshot dims agree', emulatorScreen.width === hdcScreen.width && emulatorScreen.height === hdcScreen.height)
    }
  } else {
    console.log('SKIP  live hdc screenshot: 没有本地模拟器的 hdc 目标')
  }
  eq('live hdc unknown target', await errorCode(() => hdc.shot('127.0.0.1:5999')), 'unknown-device')
}

if (failures > 0) {
  console.error('\n' + failures + ' check(s) failed')
  process.exit(1)
}
console.log('hos smoke ok')
