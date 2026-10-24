// dsh-phone · adb 层
// 只做三件事：找 adb、跑 adb、把输出解析成结构化数据。
// 所有命令一律 execFile + 参数数组，不经过 shell；serial / 地址都先过白名单。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** serial 白名单：字母数字开头，允许 . _ : -，最长 128 */
export const SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/
/** adb connect 地址：host:port，host 只允许字母数字 . - _ : */
export const ADDRESS_RE = /^[A-Za-z0-9][A-Za-z0-9.\-_:]{0,127}:\d{1,5}$/
/** `input keyevent` 白名单 */
export const KEYS = Object.freeze({
  back: '4',
  home: '3',
  recents: '187',
  power: '26',
  wakeup: '224',
  menu: '82',
  enter: '66',
})

const DEVICE_STATES = new Set([
  'device',
  'offline',
  'unauthorized',
  'authorizing',
  'recovering',
  'bootloader',
  'recovery',
  'sideload',
  'unknown',
])

const DEFAULT_TIMEOUT = 8000
const SHOT_TIMEOUT = 10000
const DEVICES_TTL = 1500
const PLATFORM_TTL = 5 * 60 * 1000

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function firstLine(buffer) {
  if (!buffer) return ''
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer)
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || ''
}

function exec(file, args, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT
  const maxBuffer = options.maxBuffer || 32 * 1024 * 1024
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer, windowsHide: true, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) {
        const message = firstLine(stderr) || firstLine(stdout) || error.message || 'adb failed'
        const failure = fail(options.code || 'adb-failed', message)
        failure.stdout = stdout
        failure.stderr = stderr
        failure.exitCode = typeof error.code === 'number' ? error.code : undefined
        failure.timedOut = error.killed === true
        reject(failure)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function prettyModel(value) {
  if (!value) return ''
  return String(value).replace(/_/g, ' ').trim()
}

/** Tailscale 的 100.64.0.0/10（RFC 6598 CGNAT） */
function isCgnatSerial(serial) {
  const match = /^(\d+)\.(\d+)\.\d+\.\d+:/.exec(serial)
  if (!match) return false
  const first = Number(match[1])
  const second = Number(match[2])
  return first === 100 && second >= 64 && second <= 127
}

/** 按 serial / adb 属性给设备标注连接方式，客户端只显示标签，不做分组。 */
export function classifyDevice(serial, props = {}) {
  if (props.usb) return 'usb'
  if (/^emulator-\d+$/.test(serial)) return 'emulator'
  if (/^unicom-openclaw-|\.ts\.net/.test(serial)) return 'tailscale'
  if (isCgnatSerial(serial)) return 'tailscale'
  if (serial.includes(':')) return 'wifi'
  return 'usb'
}

/** 解析 `adb devices -l`。纯函数，smoke 直接测它。 */
export function parseDevices(text) {
  const devices = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('List of devices')) continue
    if (line.startsWith('*') || line.startsWith('adb server') || line.startsWith('ADB server')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const serial = parts[0]
    const state = parts[1]
    if (!SERIAL_RE.test(serial)) continue
    if (!DEVICE_STATES.has(state)) continue
    const props = {}
    for (const pair of parts.slice(2)) {
      const at = pair.indexOf(':')
      if (at > 0) props[pair.slice(0, at)] = pair.slice(at + 1)
    }
    devices.push({
      serial,
      state,
      kind: classifyDevice(serial, props),
      model: prettyModel(props.model) || prettyModel(props.product) || serial,
      product: props.product || null,
      device: props.device || null,
      transportId: props.transport_id || null,
    })
  }
  return devices
}

/** 解析 `adb shell wm size`：优先 Override size（实际显示分辨率），否则 Physical size。 */
export function parseWmSize(text) {
  const source = String(text || '')
  const override = /Override size:\s*(\d{2,5})x(\d{2,5})/i.exec(source)
  const physical = /Physical size:\s*(\d{2,5})x(\d{2,5})/i.exec(source)
  const match = override || physical
  if (!match) return null
  return { width: Number(match[1]), height: Number(match[2]), overridden: Boolean(override) }
}

/** 解析 `adb shell getprop` 的 `[key]: [value]` 输出 */
export function parseGetprop(text) {
  const props = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]: \[(.*)\]$/.exec(line.trim())
    if (match) props[match[1]] = match[2]
  }
  return props
}

/** 从 getprop 属性判断系统；没有 harmony 标记的一律当 Android。 */
export function platformFromProps(props) {
  const brand = String(props['ro.product.brand'] || props['ro.product.manufacturer'] || '')
  const harmonyKeys = ['ro.build.version.harmony', 'ro.build.version.harmonyos', 'hw_sc.build.platform.version']
  for (const key of harmonyKeys) {
    const value = props[key]
    if (typeof value === 'string' && value.trim() && value.trim() !== 'unknown') return 'harmony'
  }
  if (/harmony/i.test(brand)) return 'harmony'
  return 'android'
}

function parseVersion(buffer) {
  const text = buffer ? buffer.toString('utf8') : ''
  const match = /version\s+([0-9][0-9A-Za-z.\-]*)/.exec(text)
  return match ? match[1] : null
}

/** adb 进程封装。一个实例同时服务所有设备，按 serial 串行化写操作。 */
export class Adb {
  constructor(options = {}) {
    this.configuredPath = typeof options.path === 'string' && options.path.trim() ? options.path.trim() : 'adb'
    this.timeout = Number(options.timeout) > 0 ? Number(options.timeout) : DEFAULT_TIMEOUT
    this.bin = null
    this.info = null
    this._resolving = null
    this._devices = { at: 0, list: [] }
    this._locks = new Map()
    this._screens = new Map()
    this._platforms = new Map()
  }

  /** 找到可用的 adb 可执行文件（配置值 → PATH → SDK 常见位置）。 */
  async resolve() {
    if (this.info) return this.info
    if (this._resolving) return this._resolving
    this._resolving = (async () => {
      const candidates = []
      if (this.configuredPath !== 'adb') candidates.push(this.configuredPath)
      candidates.push('adb')
      for (const env of ['ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_SDK']) {
        const value = process.env[env]
        if (value) candidates.push(join(value, 'platform-tools', 'adb'))
      }
      candidates.push(join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'))
      candidates.push('/opt/homebrew/bin/adb', '/usr/local/bin/adb')
      const seen = new Set()
      for (const candidate of candidates) {
        if (seen.has(candidate)) continue
        seen.add(candidate)
        if (candidate.includes('/') && !existsSync(candidate)) continue
        try {
          const { stdout } = await exec(candidate, ['version'], { timeout: 5000 })
          this.bin = candidate
          this.info = {
            bin: candidate,
            version: parseVersion(stdout),
            raw: stdout.toString('utf8').split(/\r?\n/).filter(Boolean).slice(0, 2),
          }
          return this.info
        } catch {
          // 继续找下一个
        }
      }
      throw fail(
        'adb-missing',
        '未找到 adb。安装 Android platform-tools，或在 cordis.patch.yml 里把 adbPath 指向 adb 可执行文件。',
      )
    })()
    try {
      return await this._resolving
    } finally {
      this._resolving = null
    }
  }

  async _run(args, options = {}) {
    await this.resolve()
    return exec(this.bin, args, options)
  }

  /** `adb devices -l`，1.5s 内复用缓存。 */
  async devices({ fresh = false } = {}) {
    const now = Date.now()
    if (!fresh && now - this._devices.at < DEVICES_TTL) {
      return { devices: this._devices.list, at: this._devices.at }
    }
    const { stdout } = await this._run(['devices', '-l'], { timeout: 5000 })
    const list = parseDevices(stdout.toString('utf8'))
    await Promise.all(
      list.map(async (device) => {
        if (device.state !== 'device') {
          device.platform = null
          return
        }
        try {
          device.platform = await Promise.race([
            this.platform(device.serial),
            new Promise((resolve) => setTimeout(() => resolve('android'), 1500)),
          ])
        } catch {
          device.platform = 'android'
        }
      }),
    )
    this._devices = { at: now, list }
    return { devices: list, at: now }
  }

  /** 设备必须出现在最新列表里且处于 device 状态，才允许执行后续操作。 */
  async assertReady(serial) {
    if (typeof serial !== 'string' || !SERIAL_RE.test(serial)) {
      throw fail('bad-serial', '设备序列号不合法')
    }
    const { devices } = await this.devices({ fresh: true })
    const device = devices.find((item) => item.serial === serial)
    if (!device) throw fail('unknown-device', `设备 ${serial} 不在 adb devices 列表里`)
    if (device.state === 'unauthorized') {
      throw fail('device-unauthorized', `设备 ${device.model} 未授权：请在手机上点「允许 USB 调试」`)
    }
    if (device.state !== 'device') {
      throw fail('device-not-ready', `设备 ${device.model} 当前状态是 ${device.state}`)
    }
    return device
  }

  /** 同一台设备的写操作串行执行，避免 input 乱序。 */
  async _locked(serial, task) {
    const previous = this._locks.get(serial) || Promise.resolve()
    const current = previous.then(task, task)
    const guarded = current.catch(() => {})
    this._locks.set(serial, guarded)
    try {
      return await current
    } finally {
      if (this._locks.get(serial) === guarded) this._locks.delete(serial)
    }
  }

  /** 系统平台（android / harmony），getprop 读一次缓存 5 分钟。 */
  async platform(serial) {
    const cached = this._platforms.get(serial)
    const now = Date.now()
    if (cached && now - cached.at < PLATFORM_TTL) return cached.platform
    const { stdout } = await this._run(['-s', serial, 'shell', 'getprop'], {
      timeout: 4000,
      maxBuffer: 4 * 1024 * 1024,
    })
    const platform = platformFromProps(parseGetprop(stdout.toString('utf8')))
    this._platforms.set(serial, { at: now, platform })
    return platform
  }

  /** 设备物理分辨率（wm size），客户端用它把画面坐标换算成输入坐标；缓存 60s。 */
  async screenInfo(serial) {
    await this.assertReady(serial)
    const cached = this._screens.get(serial)
    const now = Date.now()
    if (cached && now - cached.at < 60_000) return cached.info
    const { stdout } = await this._run(['-s', serial, 'shell', 'wm', 'size'], { timeout: 5000 })
    const info = parseWmSize(stdout.toString('utf8'))
    if (!info) throw fail('bad-screen-info', '无法读取设备分辨率')
    this._screens.set(serial, { at: now, info })
    return info
  }

  async connect(address) {
    if (typeof address !== 'string' || !ADDRESS_RE.test(address.trim())) {
      throw fail('bad-address', '地址格式应为 host:port，例如 100.90.248.53:5555')
    }
    const { stdout } = await this._run(['connect', address.trim()], { timeout: 8000 })
    this._devices.at = 0
    return { address: address.trim(), output: stdout.toString('utf8').trim() }
  }

  async disconnect(serial) {
    if (typeof serial !== 'string' || !SERIAL_RE.test(serial)) throw fail('bad-serial', '设备序列号不合法')
    const { stdout } = await this._run(['disconnect', serial], { timeout: 8000 })
    this._devices.at = 0
    return { serial, output: stdout.toString('utf8').trim() }
  }

  /** 截一帧 PNG（原始字节）。 */
  async shot(serial) {
    await this.assertReady(serial)
    const { stdout } = await this._run(['-s', serial, 'exec-out', 'screencap', '-p'], {
      timeout: SHOT_TIMEOUT,
      maxBuffer: 32 * 1024 * 1024,
    })
    if (stdout.length < 8 || stdout[0] !== 0x89 || stdout.toString('ascii', 1, 4) !== 'PNG') {
      throw fail('bad-screenshot', '设备返回的不是 PNG 截图')
    }
    return stdout
  }

  /** 点按 / 滑动 / 按键 / 旋转。坐标是设备像素。 */
  async input(serial, event = {}) {
    await this.assertReady(serial)
    const action = String(event.action || '')
    return this._locked(serial, async () => {
      switch (action) {
        case 'tap': {
          const x = clampInt(event.x, 0, 20000)
          const y = clampInt(event.y, 0, 20000)
          await this._run(['-s', serial, 'shell', 'input', 'tap', String(x), String(y)], { timeout: 5000 })
          return { action, x, y }
        }
        case 'swipe': {
          const x1 = clampInt(event.x1, 0, 20000)
          const y1 = clampInt(event.y1, 0, 20000)
          const x2 = clampInt(event.x2, 0, 20000)
          const y2 = clampInt(event.y2, 0, 20000)
          const duration = clampInt(event.duration, 50, 5000)
          await this._run(
            ['-s', serial, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(duration)],
            { timeout: 8000 },
          )
          return { action, x1, y1, x2, y2, duration }
        }
        case 'key': {
          const key = String(event.key || '')
          const code = KEYS[key]
          if (!code) throw fail('bad-key', `不支持的按键: ${key}`)
          await this._run(['-s', serial, 'shell', 'input', 'keyevent', code], { timeout: 5000 })
          return { action, key }
        }
        case 'rotate': {
          const { stdout } = await this._run(['-s', serial, 'shell', 'settings', 'get', 'system', 'user_rotation'], {
            timeout: 5000,
          })
          const current = Number(stdout.toString('utf8').trim()) || 0
          const next = (current + 1) % 4
          await this._run(['-s', serial, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'], {
            timeout: 5000,
          })
          await this._run(['-s', serial, 'shell', 'settings', 'put', 'system', 'user_rotation', String(next)], {
            timeout: 5000,
          })
          return { action, rotation: next }
        }
        default:
          throw fail('bad-action', `不支持的操作: ${action || '(empty)'}`)
      }
    })
  }
}

function clampInt(value, min, max) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) throw fail('bad-coordinate', '坐标必须是数字')
  return Math.min(max, Math.max(min, number))
}
