// dsh-phone · 鸿蒙 transport 层（DevEco 模拟器 + hdc）
// 只做三件事：找可执行文件、跑命令、把输出解析成结构化数据。
// 所有命令一律 execFile + 参数数组，不经过 shell；名称 / serial / 坐标 / 文本都先过白名单。
//
// 两个入口：
//   HarmonyEmulator  DevEco 模拟器：-list / -imageList / -create / -start / -stop / -delete，
//                    截图走 -screenshot（PNG），点按/滑动/旋转/电源走 -click / -slide / -rotation / -power，
//                    按键和文字没有 CLI 能力，内部转给 hdc uitest。
//   HarmonyHdc       真机 / 云手机：hdc list targets，截图走 snapshot_display + file recv（JPEG），
//                    输入走 uitest uiInput。默认从列表里过滤 model=emulator 的本地模拟器。
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** hdc serial 白名单：字母数字开头，允许 . _ : -，最长 128 */
export const HDC_SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/
/** 模拟器实例名：字母/数字/中文开头，允许空格 . _ -，最长 64；不允许路径分隔符 */
export const EMULATOR_NAME_RE = /^[A-Za-z0-9_+][A-Za-z0-9 _+]{0,63}$/
/**
 * uitest 文字白名单：字母、数字、空格和少量安全标点。
 * hdc shell 最终会经过设备 shell，`$` `;` `` ` `` `|` `&` 引号等一律不收。
 */
export const TEXT_RE = /^[\p{L}\p{N} .,!@%+_=:\/-]{1,200}$/u
/** hdc uitest keyEvent 支持的名字（其余只收数字 keyID） */
export const KEYS = Object.freeze({
  back: 'Back',
  home: 'Home',
  power: 'Power',
})
/** 设备类型 → Emulator CLI 文档里的取值 */
export const DEVICE_TYPES = Object.freeze({
  phone: 'Phone',
  foldable: 'Foldable',
  widefold: 'WideFold',
  'wide fold': 'WideFold',
  triplefold: 'TripleFold',
  'triple fold': 'TripleFold',
  tablet: 'Tablet',
  '2in1': '2in1',
  '2in1 foldable': '2in1 Foldable',
  wearable: 'Wearable',
  wearablekid: 'WearableKid',
  'wearable kid': 'WearableKid',
  tv: 'TV',
  car: 'Car',
})

const DEFAULT_TIMEOUT = 8000
const EMULATOR_TIMEOUT = 15000
const SHOT_TIMEOUT = 20000
const TRANSFER_TIMEOUT = 30000
const START_TIMEOUT = 90_000
const STOP_TIMEOUT = 30_000
const CREATE_TIMEOUT = 180_000
const REMOVE_TIMEOUT = 60_000
const POLL_INTERVAL = 500
const LIST_TTL = 1500
const PROFILE_TTL = 5 * 60 * 1000
const IMAGE_TTL = 5 * 60 * 1000
const SCREEN_TTL = 5 * 60 * 1000
const MAX_BUFFER = 8 * 1024 * 1024

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function positive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function boolValue(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function firstLine(buffer) {
  if (!buffer) return ''
  const source = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer)
  return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || ''
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function unique(list) {
  const seen = new Set()
  const result = []
  for (const item of list) {
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

function clampInt(value, min, max, label) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) throw fail('bad-coordinate', `${label} 必须是数字`)
  return Math.min(max, Math.max(min, number))
}

function hasPoint(event) {
  return (
    event.x !== undefined &&
    event.x !== null &&
    event.y !== undefined &&
    event.y !== null
  )
}

function keyArgument(value) {
  const key = text(value)
  if (!key) throw fail('bad-key', '按键不能为空（可用 back / home / power 或数字 keyID）')
  const named = KEYS[key.toLowerCase()]
  if (named) return named
  if (/^\d{1,5}$/.test(key)) return key
  throw fail('bad-key', `不支持的按键: ${key}（可用 back / home / power 或数字 keyID）`)
}

function textArgument(event) {
  const value = typeof event.text === 'string' ? event.text : typeof event.value === 'string' ? event.value : ''
  if (!TEXT_RE.test(value)) {
    throw fail('bad-text', '文字为空或包含不支持的字符（只允许文字/数字/空格和 .,!@%+_=:/- ）')
  }
  return value
}

function exec(file, args, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT
  const maxBuffer = options.maxBuffer || MAX_BUFFER
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer, windowsHide: true, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) {
        const message = firstLine(stderr) || firstLine(stdout) || error.message || 'command failed'
        const failure = fail(options.code || 'command-failed', message)
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

function jsonArray(source, code, label) {
  const raw = String(source || '')
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) throw fail(code, `${label} 输出不是 JSON 数组`)
  let value
  try {
    value = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw fail(code, `${label} 输出不是合法 JSON 数组`)
  }
  if (!Array.isArray(value)) throw fail(code, `${label} 输出不是 JSON 数组`)
  return value
}

function parseEmulatorVersion(source) {
  const match = /Emulator\s*:\s*([0-9][0-9A-Za-z.\-]*)/.exec(String(source || ''))
  return match ? match[1] : null
}

function parseHdcVersion(source) {
  const match = /Ver:\s*([0-9A-Za-z.\-]+)/.exec(String(source || ''))
  return match ? match[1] : null
}

function isLoopbackSerial(serial) {
  return /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]):\d{1,5}$/.test(serial)
}

function isEmulatorProfile(profile) {
  if (!profile) return false
  return /emulator/i.test(profile.model || '') || /emulator/i.test(profile.name || '')
}

function readScreenshot(file) {
  try {
    return readFileSync(file)
  } catch (error) {
    throw fail('bad-screenshot', `读取截图文件失败：${error.message || error}`)
  }
}

function newestScreenshot(dir) {
  let files
  try {
    files = readdirSync(dir).filter((name) => /\.png$/i.test(name))
  } catch {
    return null
  }
  if (files.length === 0) return null
  files.sort((left, right) => statSync(join(dir, right)).mtimeMs - statSync(join(dir, left)).mtimeMs)
  return join(dir, files[0])
}

/**
 * 等截图文件真正写完。
 * Emulator -screenshot 会先打印成功再在后台落盘；实测命令返回后约 70ms 才出现文件，
 * 而且大小会继续增长，所以按「文件存在 + 大小连续两次不变」判定写完。
 */
async function waitForScreenshot(dir, timeout) {
  const deadline = Date.now() + timeout
  let previous = -1
  let stable = 0
  while (Date.now() < deadline) {
    const file = newestScreenshot(dir)
    if (file) {
      let size = 0
      try {
        size = statSync(file).size
      } catch {
        size = 0
      }
      if (size > 0) {
        if (size === previous) {
          stable += 1
          if (stable >= 2) return file
        } else {
          previous = size
          stable = 0
        }
      }
    }
    await sleep(100)
  }
  return null
}

let devEcoAppsCache = null
/** DevEco Studio.app 候选（桌面版优先），找不到就返回空数组。 */
function devEcoApps() {
  if (devEcoAppsCache) return devEcoAppsCache
  const apps = []
  for (const base of ['/Applications', join(homedir(), 'Applications')]) {
    let entries = []
    try {
      entries = readdirSync(base)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (/^DevEco.*\.app$/i.test(entry)) apps.push(join(base, entry))
    }
  }
  apps.sort()
  const desktop = apps.filter((item) => /DevEco-Studio\.app$/i.test(item))
  devEcoAppsCache = unique([...desktop, ...apps])
  return devEcoAppsCache
}

function emulatorCandidates(configuredPath) {
  const candidates = []
  if (configuredPath) candidates.push(configuredPath)
  for (const env of ['DSH_EMULATOR_PATH', 'DEVECO_EMULATOR_PATH']) {
    const value = process.env[env]
    if (value) candidates.push(value)
  }
  for (const app of devEcoApps()) candidates.push(join(app, 'Contents', 'tools', 'emulator', 'Emulator'))
  candidates.push('/Applications/DevEco-Studio.app/Contents/tools/emulator/Emulator')
  candidates.push('Emulator')
  return unique(candidates)
}

function hdcCandidates(configuredPath) {
  const candidates = []
  if (configuredPath) candidates.push(configuredPath)
  for (const env of ['DSH_HDC_PATH', 'HDC_PATH']) {
    const value = process.env[env]
    if (value) candidates.push(value)
  }
  candidates.push('hdc')
  candidates.push(join(homedir(), '.local', 'bin', 'hdc'))
  const sdkHome = process.env.DEVECO_SDK_HOME
  if (sdkHome) candidates.push(join(sdkHome, 'default', 'openharmony', 'toolchains', 'hdc'))
  for (const app of devEcoApps()) {
    candidates.push(join(app, 'Contents', 'sdk', 'default', 'openharmony', 'toolchains', 'hdc'))
  }
  candidates.push('/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc')
  return unique(candidates)
}

/** 解析 `Emulator -list -details` 的 JSON。纯函数，smoke 直接测它。 */
export function parseEmulatorList(source) {
  const devices = []
  for (const item of jsonArray(source, 'emulator-parse', 'Emulator -list -details')) {
    if (!item || typeof item !== 'object') continue
    const name = text(item.name)
    if (!name) continue
    const running = boolValue(item.isRunning)
    devices.push({
      serial: name,
      state: running ? 'device' : 'offline',
      model: text(item.productModel) || text(item.deviceModel) || name,
      platform: 'harmony',
      kind: 'simulator',
      width: numberOrNull(item['hw.lcd.single.width']) ?? numberOrNull(item['hw.lcd.double.width']),
      height: numberOrNull(item['hw.lcd.single.height']) ?? numberOrNull(item['hw.lcd.double.height']),
      transport: 'emulator',
      osVersion: text(item['os.osVersion']) || null,
      deviceType: text(item.deviceType) || null,
    })
  }
  return devices
}

/** 解析 `Emulator -imageList -deviceType phone` 的 JSON。纯函数。 */
export function parseImageList(source) {
  const images = []
  for (const item of jsonArray(source, 'emulator-parse', 'Emulator -imageList')) {
    if (!item || typeof item !== 'object') continue
    const osVersion = text(item.osVersion)
    if (!osVersion) continue
    const apiMatch = /\(([^()]+)\)/.exec(osVersion)
    images.push({
      osVersion,
      apiVersion: text(item['os.apiVersion']) || (apiMatch ? apiMatch[1].trim() : null),
      softwareVersion: text(item.SoftWareVersion) || text(item.softwareVersion) || null,
      deviceType: text(item.deviceType).toLowerCase() || 'phone',
      downloaded: boolValue(item.downloaded),
      releaseType: text(item.releaseType) || null,
      upgradable: boolValue(item.upgradable),
    })
  }
  return images
}

/** 解析 `hdc list targets [-v]`。纯函数；-v 每行是 serial\t\t类型\t状态\t... */
export function parseHdcTargets(source) {
  const bySerial = new Map()
  for (const raw of String(source || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('[')) continue
    const parts = line.split(/\t+/).map((part) => part.trim()).filter(Boolean)
    const serial = parts[0]
    if (!HDC_SERIAL_RE.test(serial)) continue
    let connection = null
    let state = 'device'
    if (parts.length >= 3) {
      connection = parts[1].toUpperCase()
      state = /connect/i.test(parts[2]) ? 'device' : 'offline'
    } else if (parts.length === 2) {
      connection = parts[1].toUpperCase()
    }
    bySerial.set(serial, { serial, state, connection })
  }
  return [...bySerial.values()]
}

/** PNG 签名（8 字节）。 */
export function isPng(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.toString('ascii', 1, 4) === 'PNG'
  )
}

/** JPEG SOI（FF D8）。 */
export function isJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8
}

/** 从 PNG IHDR 读宽高。 */
export function parsePngSize(buffer) {
  if (!isPng(buffer) || buffer.length < 24) return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}

/** 从 JPEG SOFn 读宽高（截图轮询用，不依赖第三方库）。 */
export function parseJpegSize(buffer) {
  if (!isJpeg(buffer) || buffer.length < 4) return null
  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    let marker = buffer[offset + 1]
    while (marker === 0xff && offset + 2 < buffer.length) {
      offset += 1
      marker = buffer[offset + 1]
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 4 > buffer.length) return null
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) return null
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > buffer.length) return null
      const height = buffer.readUInt16BE(offset + 5)
      const width = buffer.readUInt16BE(offset + 7)
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += 2 + length
  }
  return null
}

/** 从 `snapshot_display` 输出里抓宽高（最后一条 width/height 最准）。 */
export function parseSnapshotSize(source) {
  const matches = [...String(source || '').matchAll(/width:\s*(\d+)\s*,\s*height:\s*(\d+)/gi)]
  if (matches.length === 0) return null
  const last = matches[matches.length - 1]
  const width = Number(last[1])
  const height = Number(last[2])
  return width > 0 && height > 0 ? { width, height } : null
}

/** 设备类型归一化（大小写 / 空格 / 下划线都不敏感）。 */
export function normalizeDeviceType(value) {
  const key = String(value === undefined || value === null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
  const normalized = DEVICE_TYPES[key]
  if (!normalized) {
    throw fail('bad-device-type', `不支持的设备类型: ${value || '(empty)'}（可用 ${Object.keys(DEVICE_TYPES).join(' / ')}）`)
  }
  return normalized
}

/** 校验并归一化模拟器实例名。 */
export function normalizeEmulatorName(value) {
  const name = text(value)
  if (!EMULATOR_NAME_RE.test(name)) {
    throw fail('bad-emulator-name', '模拟器名称不合法：只能用字母、数字、空格、下划线 _、加号 +（最长 64，CLI 不允许中文和连字符）')
  }
  return name
}

function assertHdcSerial(serial) {
  if (typeof serial !== 'string' || !HDC_SERIAL_RE.test(serial)) {
    throw fail('bad-serial', '设备序列号不合法')
  }
  return serial
}

/**
 * hdc 进程封装。一个实例同时服务所有设备，写操作按 serial 串行化。
 * 默认 list() 过滤掉 model=emulator 的本地模拟器（模拟器归 HarmonyEmulator 管）。
 */
export class HarmonyHdc {
  constructor(options = {}) {
    this.configuredPath = text(options.path)
    this.timeout = positive(options.timeout) || DEFAULT_TIMEOUT
    this.shotTimeout = positive(options.shotTimeout) || SHOT_TIMEOUT
    this.transferTimeout = positive(options.transferTimeout) || TRANSFER_TIMEOUT
    this.bin = null
    this.info = null
    this._resolving = null
    this._targetsCache = { at: 0, list: [] }
    this._profiles = new Map()
    this._screens = new Map()
    this._locks = new Map()
    this._sequence = 0
  }

  /** 找到可用的 hdc（配置值 → PATH → ~/.local/bin → DevEco SDK）。 */
  async resolve() {
    if (this.info) return this.info
    if (this._resolving) return this._resolving
    this._resolving = (async () => {
      for (const candidate of hdcCandidates(this.configuredPath)) {
        if (candidate.includes('/') && !existsSync(candidate)) continue
        try {
          const { stdout } = await exec(candidate, ['-v'], { timeout: 5000, code: 'hdc-missing' })
          this.bin = candidate
          this.info = { bin: candidate, version: parseHdcVersion(stdout.toString('utf8')) }
          return this.info
        } catch {
          // 继续找下一个
        }
      }
      throw fail(
        'hdc-missing',
        '未找到 hdc。安装 DevEco Studio / HarmonyOS SDK，或者把 hdcPath 指向 hdc 可执行文件。',
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
    const result = await exec(this.bin, args, {
      timeout: options.timeout || this.timeout,
      maxBuffer: options.maxBuffer || MAX_BUFFER,
      code: options.code || 'hdc-failed',
    })
    // hdc 的失败经常是 exit 0 + stdout 里的 [Fail]，必须单独识别
    const output = result.stdout.toString('utf8')
    if (/\[Fail\]/i.test(output)) {
      const line = output.split(/\r?\n/).find((item) => /\[Fail\]/i.test(item)) || ''
      throw fail(options.failCode || 'hdc-failed', line.replace(/\[Fail\]/gi, '').trim() || 'hdc 执行失败')
    }
    return result
  }

  async _listTargets({ fresh = false } = {}) {
    const now = Date.now()
    if (!fresh && now - this._targetsCache.at < LIST_TTL) return this._targetsCache.list
    let source
    try {
      const { stdout } = await this._run(['list', 'targets', '-v'], { timeout: this.timeout })
      source = stdout.toString('utf8')
      if (/usage|unknown option|not support/i.test(source)) source = ''
    } catch (error) {
      if (error.code === 'hdc-missing') throw error
      source = ''
    }
    if (!source) {
      const { stdout } = await this._run(['list', 'targets'], { timeout: this.timeout })
      source = stdout.toString('utf8')
    }
    const list = parseHdcTargets(source)
    this._targetsCache = { at: now, list }
    return list
  }

  async _param(serial, key) {
    const { stdout } = await this._run(['-t', serial, 'shell', 'param', 'get', key], {
      timeout: this.timeout,
      maxBuffer: 1024 * 1024,
      failCode: 'hdc-param-failed',
    })
    return stdout.toString('utf8').trim()
  }

  /** 设备型号信息，5 分钟缓存；多个 param get 并行跑。 */
  async profile(serial, options = {}) {
    assertHdcSerial(serial)
    const cached = this._profiles.get(serial)
    const now = Date.now()
    if (!options.fresh && cached && now - cached.at < PROFILE_TTL) return cached.value
    const [model, name, brand] = await Promise.all([
      this._param(serial, 'const.product.model'),
      this._param(serial, 'const.product.name'),
      this._param(serial, 'const.product.brand'),
    ])
    const value = { model, name, brand }
    this._profiles.set(serial, { at: now, value })
    return value
  }

  /**
   * hdc 设备列表。
   * @param {{fresh?: boolean, includeSimulators?: boolean, profiles?: boolean, profilesFresh?: boolean}} options
   */
  async targets(options = {}) {
    const includeSimulators = options.includeSimulators === true
    const base = await this._listTargets({ fresh: options.fresh })
    if (options.profiles === false) {
      return base.map((target) => this._device(target, null, false))
    }
    const rows = await Promise.all(
      base.map(async (target) => {
        let profile = null
        if (target.state === 'device') {
          try {
            profile = await this.profile(target.serial, { fresh: options.profilesFresh })
          } catch {
            profile = null
          }
        }
        return { target, profile }
      }),
    )
    const devices = []
    for (const row of rows) {
      // param 读不到时，回环 TCP 目标按模拟器处理，避免模拟器在 hdc 列表里重复出现
      const simulator = isEmulatorProfile(row.profile) || (!row.profile && isLoopbackSerial(row.target.serial))
      if (simulator && !includeSimulators) continue
      devices.push(this._device(row.target, row.profile, simulator))
    }
    return devices
  }

  /** 与 PhoneTransport 对齐的列表：默认不含本地模拟器。 */
  async list(options = {}) {
    return this.targets(options)
  }

  /** 任务板命名兼容：和 list() 等价。 */
  async listTargets(options = {}) {
    return this.targets(options)
  }

  _device(target, profile, simulator) {
    const screen = this._screens.get(target.serial)
    return {
      serial: target.serial,
      state: target.state === 'device' ? 'device' : 'offline',
      model: (profile && (profile.name || profile.model)) || target.serial,
      platform: 'harmony',
      kind: simulator ? 'simulator' : target.connection === 'TCP' ? 'wifi' : 'usb',
      width: screen ? screen.info.width : null,
      height: screen ? screen.info.height : null,
      transport: 'hdc',
      connection: target.connection || null,
    }
  }

  /** serial 必须出现在最新 target 列表里且已连接。 */
  async assertReady(serial) {
    assertHdcSerial(serial)
    const targets = await this._listTargets({ fresh: true })
    const target = targets.find((item) => item.serial === serial)
    if (!target) throw fail('unknown-device', `设备 ${serial} 不在 hdc list targets 里`)
    if (target.state !== 'device') throw fail('device-not-ready', `设备 ${serial} 当前状态是 offline`)
    return target
  }

  /** 找本地模拟器的 hdc serial（供 HarmonyEmulator 的 key/text 使用）。 */
  async emulatorSerial(options = {}) {
    const targets = await this._listTargets({ fresh: options.fresh })
    const local = targets.filter((target) => target.state === 'device' && isLoopbackSerial(target.serial))
    if (local.length === 1) return local[0].serial
    if (local.length > 1) {
      const emulators = []
      for (const target of local) {
        try {
          const profile = await this.profile(target.serial, { fresh: options.fresh })
          if (isEmulatorProfile(profile)) emulators.push(target.serial)
        } catch {
          // 读不到 param 就跳过，交给下面的歧义报错
        }
      }
      if (emulators.length === 1) return emulators[0]
      throw fail(
        'ambiguous-emulator',
        `有多个本地 hdc 目标，无法确定是哪个模拟器：${local.map((item) => item.serial).join(', ')}；请在事件里显式指定 serial`,
      )
    }
    const emulators = []
    for (const target of targets) {
      if (target.state !== 'device') continue
      try {
        const profile = await this.profile(target.serial, { fresh: options.fresh })
        if (isEmulatorProfile(profile)) emulators.push(target.serial)
      } catch {
        // 忽略
      }
    }
    if (emulators.length === 1) return emulators[0]
    throw fail('hdc-serial-unknown', '没有找到模拟器的 hdc 目标，确认模拟器已启动并已连上 hdc')
  }

  _remotePath(extension) {
    this._sequence += 1
    return `/data/local/tmp/dsh-phone-${process.pid}-${this._sequence}.${extension}`
  }

  /** 截一帧 JPEG：设备上 snapshot_display → file recv → 读内存 → 清理远端/本地临时文件。 */
  async shot(serial) {
    await this.assertReady(serial)
    const localDir = mkdtempSync(join(tmpdir(), 'dsh-phone-hos-'))
    const remote = this._remotePath('jpeg')
    try {
      const { stdout } = await this._run(['-t', serial, 'shell', 'snapshot_display', '-f', remote], {
        timeout: this.shotTimeout,
        failCode: 'hdc-shot-failed',
      })
      const local = join(localDir, 'shot.jpeg')
      await this._run(['-t', serial, 'file', 'recv', remote, local], {
        timeout: this.transferTimeout,
        failCode: 'hdc-transfer-failed',
      })
      const buffer = readScreenshot(local)
      if (!isJpeg(buffer)) throw fail('bad-screenshot', 'hdc 返回的不是 JPEG 截图')
      if (buffer.length < 4 || buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
        throw fail('bad-screenshot', 'hdc 截图不完整（缺 JPEG EOI）')
      }
      const size = parseSnapshotSize(stdout.toString('utf8')) || parseJpegSize(buffer)
      if (size) this._screens.set(serial, { at: Date.now(), info: size })
      return buffer
    } finally {
      try {
        await this._run(['-t', serial, 'shell', 'rm', '-f', remote], { timeout: 5000 })
      } catch {
        // 清理失败不影响截图结果
      }
      rmSync(localDir, { recursive: true, force: true })
    }
  }

  /** 分辨率：优先从 snapshot_display 输出推断，取不到再回退到整张截图；缓存 5 分钟。 */
  async screenInfo(serial, options = {}) {
    await this.assertReady(serial)
    const cached = this._screens.get(serial)
    const now = Date.now()
    if (!options.fresh && cached && now - cached.at < SCREEN_TTL) return cached.info
    const remote = this._remotePath('jpeg')
    let info = null
    try {
      const { stdout } = await this._run(['-t', serial, 'shell', 'snapshot_display', '-f', remote], {
        timeout: this.shotTimeout,
        failCode: 'hdc-shot-failed',
      })
      info = parseSnapshotSize(stdout.toString('utf8'))
    } finally {
      try {
        await this._run(['-t', serial, 'shell', 'rm', '-f', remote], { timeout: 5000 })
      } catch {
        // 忽略清理失败
      }
    }
    if (!info) info = parseJpegSize(await this.shot(serial))
    if (!info) throw fail('bad-screen-info', '无法从 hdc 截图推断分辨率')
    this._screens.set(serial, { at: Date.now(), info })
    return info
  }

  /** 同一台设备的写操作串行执行，避免输入乱序。 */
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

  async _ui(serial, args) {
    await this._run(['-t', serial, 'shell', 'uitest', 'uiInput', ...args], {
      timeout: this.timeout,
      failCode: 'hdc-input-failed',
    })
  }

  async _text(serial, event, value, forcePoint) {
    if (hasPoint(event)) {
      const x = clampInt(event.x, 0, 20000, 'x')
      const y = clampInt(event.y, 0, 20000, 'y')
      await this._ui(serial, ['inputText', String(x), String(y), value])
      return { action: 'inputText', x, y }
    }
    if (forcePoint) throw fail('bad-coordinate', 'inputText 需要 x / y 坐标')
    await this._ui(serial, ['text', value])
    return { action: 'text' }
  }

  /** 点按 / 滑动 / 按键 / 文字。坐标是设备像素。 */
  async input(serial, event = {}) {
    await this.assertReady(serial)
    const action = String(event.action || '')
    return this._locked(serial, async () => {
      switch (action) {
        case 'tap': {
          const x = clampInt(event.x, 0, 20000, 'x')
          const y = clampInt(event.y, 0, 20000, 'y')
          await this._ui(serial, ['click', String(x), String(y)])
          return { action, x, y }
        }
        case 'swipe': {
          const x1 = clampInt(event.x1, 0, 20000, 'x1')
          const y1 = clampInt(event.y1, 0, 20000, 'y1')
          const x2 = clampInt(event.x2, 0, 20000, 'x2')
          const y2 = clampInt(event.y2, 0, 20000, 'y2')
          const args = ['swipe', String(x1), String(y1), String(x2), String(y2)]
          let velocity = null
          if (event.velocity !== undefined && event.velocity !== null) {
            velocity = clampInt(event.velocity, 200, 40000, 'velocity')
            args.push(String(velocity))
          }
          await this._ui(serial, args)
          return { action, x1, y1, x2, y2, velocity }
        }
        case 'key': {
          const key = keyArgument(event.key)
          await this._ui(serial, ['keyEvent', key])
          return { action, key }
        }
        case 'text': {
          return this._text(serial, event, textArgument(event), false)
        }
        case 'inputText': {
          return this._text(serial, event, textArgument(event), true)
        }
        default:
          throw fail('bad-action', `不支持的操作: ${action || '(empty)'}`)
      }
    })
  }
}

/**
 * DevEco 模拟器 CLI 封装。
 * 截图是 PNG；点按/滑动/旋转/电源走 CLI；按键和文字借道 hdc（模拟器没有对应 CLI）。
 */
export class HarmonyEmulator {
  constructor(options = {}) {
    this.configuredPath = text(options.path)
    this.timeout = positive(options.timeout) || EMULATOR_TIMEOUT
    this.shotTimeout = positive(options.shotTimeout) || SHOT_TIMEOUT
    this.startTimeout = positive(options.startTimeout) || START_TIMEOUT
    this.stopTimeout = positive(options.stopTimeout) || STOP_TIMEOUT
    this.createTimeout = positive(options.createTimeout) || CREATE_TIMEOUT
    this.removeTimeout = positive(options.removeTimeout) || REMOVE_TIMEOUT
    this.configuredHdcSerial = text(options.hdcSerial)
    this.hdc =
      options.hdc && typeof options.hdc.input === 'function'
        ? options.hdc
        : new HarmonyHdc({ path: options.hdcPath, timeout: options.hdcTimeout })
    this.bin = null
    this.info = null
    this._resolving = null
    this._screens = new Map()
    this._images = new Map()
    this._locks = new Map()
    this._emulatorSerial = null
    this._emulatorSerialAt = 0
  }

  /** 找到可用的 Emulator CLI（配置值 → DevEco Studio.app）。 */
  async resolve() {
    if (this.info) return this.info
    if (this._resolving) return this._resolving
    this._resolving = (async () => {
      for (const candidate of emulatorCandidates(this.configuredPath)) {
        if (candidate.includes('/') && !existsSync(candidate)) continue
        try {
          const { stdout } = await exec(candidate, ['-version'], { timeout: 5000, code: 'emulator-missing' })
          this.bin = candidate
          this.info = { bin: candidate, version: parseEmulatorVersion(stdout.toString('utf8')) }
          return this.info
        } catch {
          // 继续找下一个
        }
      }
      throw fail(
        'emulator-missing',
        '未找到 HarmonyOS 模拟器 CLI。安装 DevEco Studio，或者把 emulatorPath 指向 Contents/tools/emulator/Emulator。',
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
    return exec(this.bin, args, {
      timeout: options.timeout || this.timeout,
      maxBuffer: options.maxBuffer || MAX_BUFFER,
      code: options.code || 'emulator-failed',
    })
  }

  /** 所有实例（含未运行），按 JSON 详情解析。 */
  async list() {
    const { stdout } = await this._run(['-list', '-details'], { timeout: this.timeout })
    return parseEmulatorList(stdout.toString('utf8'))
  }

  /** 可下载 / 已下载镜像。CLI 会联网检查更新、单次约 1s，按设备类型缓存 5 分钟。 */
  async imageList(options = {}) {
    const deviceType = normalizeDeviceType(options.deviceType || 'phone')
    const cached = this._images.get(deviceType)
    const now = Date.now()
    if (!options.fresh && cached && now - cached.at < IMAGE_TTL) return cached.value
    const { stdout } = await this._run(['-imageList', '-deviceType', deviceType.toLowerCase()], {
      timeout: this.timeout,
    })
    const images = parseImageList(stdout.toString('utf8'))
    this._images.set(deviceType, { at: now, value: images })
    return images
  }

  async find(name) {
    const instance = normalizeEmulatorName(name)
    const list = await this.list()
    const device = list.find((item) => item.serial === instance)
    if (!device) throw fail('unknown-emulator', `模拟器 ${instance} 不存在（Emulator -list 里没有）`)
    return device
  }

  _assertRunning(device) {
    if (device.state !== 'device') {
      throw fail('emulator-not-running', `模拟器 ${device.serial} 未运行，先 start() 再操作`)
    }
  }

  async _poll(name, predicate, timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const list = await this.list()
      const device = list.find((item) => item.serial === name)
      if (device && predicate(device)) return device
      await sleep(POLL_INTERVAL)
    }
    return null
  }

  async _pollGone(name, timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const list = await this.list()
      if (!list.some((item) => item.serial === name)) return true
      await sleep(POLL_INTERVAL)
    }
    return false
  }

  /** 新建实例（镜像必须已下载）。 */
  async create(options = {}) {
    const name = normalizeEmulatorName(options.name)
    const osVersion = text(options.osVersion)
    if (!osVersion) throw fail('bad-os-version', 'osVersion 不能为空，例如 "HarmonyOS 7.0.0(26.0.0)"')
    const deviceType = normalizeDeviceType(options.deviceType || 'phone')
    const images = await this.imageList({ deviceType })
    const image = images.find((item) => item.osVersion === osVersion)
    if (!image) {
      const available = images.map((item) => item.osVersion).slice(0, 5).join(' / ')
      throw fail('image-missing', `没有 ${osVersion} 的 ${deviceType} 镜像；可用：${available || '(无)'}`)
    }
    if (!image.downloaded) {
      throw fail('image-not-downloaded', `${osVersion} 镜像还没下载，先 Emulator -install 或换一个已下载版本`)
    }
    const existing = await this.list()
    if (existing.some((item) => item.serial === name)) throw fail('emulator-exists', `模拟器 ${name} 已存在`)
    const args = ['-create', name, '-deviceType', deviceType, '-osVersion', osVersion]
    if (options.storage !== undefined && options.storage !== null) {
      args.push('-storage', String(clampInt(options.storage, 2, 1023, 'storage')))
    }
    if (options.memory !== undefined && options.memory !== null) {
      args.push('-memory', String(clampInt(options.memory, 2, 32, 'memory')))
    }
    if (typeof options.hotBoot === 'boolean') args.push('-hotBoot', String(options.hotBoot))
    const { stdout } = await this._run(args, { timeout: this.createTimeout })
    const created = await this._poll(name, () => true, Math.min(this.startTimeout, 15000))
    if (!created) {
      throw fail('create-failed', `创建命令已执行，但实例 ${name} 没出现在列表里：${firstLine(stdout) || '(无输出)'}`)
    }
    return created
  }

  /** 启动并等到 isRunning=true。已经在跑就直接返回。 */
  async start(name) {
    const instance = normalizeEmulatorName(name)
    const existing = await this.find(instance)
    if (existing.state === 'device') return existing
    // Emulator -start 是常驻进程（前台阻塞直到模拟器退出），必须 detached 启动再轮询状态。
    // 状态变成 device 之后显示服务还需要一点时间，所以用一次真实截图做 warm-up。
    await this.resolve()
    const child = spawn(this.bin, ['-start', instance, '-noWindow'], { detached: true, stdio: 'ignore' })
    child.unref()
    const deadline = Date.now() + this.startTimeout
    while (Date.now() < deadline) {
      const list = await this.list()
      const device = list.find((item) => item.serial === instance)
      if (device && device.state === 'device') {
        try {
          await this.shot(instance)
          return device
        } catch {
          await sleep(2000)
          continue
        }
      }
      await sleep(1000)
    }
    throw fail('start-timeout', `模拟器 ${instance} 在 ${Math.round(this.startTimeout / 1000)}s 内没有启动完成`)
  }

  /** 停止并等到 isRunning=false。已经停止就直接返回。 */
  async stop(name) {
    const instance = normalizeEmulatorName(name)
    const existing = await this.find(instance)
    if (existing.state !== 'device') return existing
    await this._run(['-stop', instance], { timeout: this.stopTimeout })
    const stopped = await this._poll(instance, (device) => device.state !== 'device', this.stopTimeout)
    if (!stopped) {
      throw fail('stop-timeout', `模拟器 ${instance} 在 ${Math.round(this.stopTimeout / 1000)}s 内没有停下来`)
    }
    return stopped
  }

  /** 删除实例（要求先停止，避免误伤正在跑的画面）。 */
  async remove(name) {
    const instance = normalizeEmulatorName(name)
    const existing = await this.find(instance)
    if (existing.state === 'device') {
      throw fail('emulator-running', `模拟器 ${instance} 正在运行，先 stop() 再 remove()`)
    }
    await this._run(['-delete', instance, '-force'], { timeout: this.removeTimeout })
    const gone = await this._pollGone(instance, Math.min(this.removeTimeout, 15000))
    if (!gone) throw fail('remove-failed', `删除命令已执行，但实例 ${instance} 仍在列表里`)
    return { name: instance, removed: true }
  }

  /** 任务板里的 delete() 命名兼容。 */
  async delete(name) {
    return this.remove(name)
  }

  /** 截一帧 PNG（原始字节）。 */
  async shot(name) {
    const instance = normalizeEmulatorName(name)
    const device = await this.find(instance)
    this._assertRunning(device)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-phone-hos-'))
    try {
      const { stdout, stderr } = await this._run(
        ['-instance', instance, '-screenshot', '-screenshotPath', dir],
        { timeout: this.shotTimeout },
      )
      const file = await waitForScreenshot(dir, this.shotTimeout)
      if (!file) {
        const detail = firstLine(stdout) || firstLine(stderr) || '(无输出)'
        throw fail('bad-screenshot', `模拟器没有在 ${this.shotTimeout}ms 内产出 PNG 截图：${detail}`)
      }
      const buffer = readScreenshot(file)
      if (!isPng(buffer)) throw fail('bad-screenshot', '模拟器截图不是 PNG')
      if (buffer.length < 16 || buffer.toString('ascii', buffer.length - 8, buffer.length - 4) !== 'IEND') {
        throw fail('bad-screenshot', '模拟器截图不完整（缺 PNG IEND）')
      }
      const size = parsePngSize(buffer)
      if (size) this._screens.set(instance, { at: Date.now(), info: size })
      return buffer
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  async _hdcSerial(options = {}) {
    const explicit = text(options.serial) || this.configuredHdcSerial
    if (explicit) {
      if (!HDC_SERIAL_RE.test(explicit)) throw fail('bad-serial', 'hdc 序列号不合法')
      return explicit
    }
    const now = Date.now()
    if (!options.fresh && this._emulatorSerial && now - this._emulatorSerialAt < 30_000) {
      return this._emulatorSerial
    }
    if (typeof this.hdc.emulatorSerial !== 'function') {
      throw fail('hdc-serial-unknown', '无法自动定位模拟器的 hdc 序列号：请在事件里显式指定 serial')
    }
    const serial = await this.hdc.emulatorSerial({ fresh: options.fresh })
    this._emulatorSerial = serial
    this._emulatorSerialAt = now
    return serial
  }

  /** 点按 / 滑动 / 旋转 / 电源走 Emulator CLI；按键 / 文字走 hdc uitest。 */
  async input(name, event = {}) {
    const instance = normalizeEmulatorName(name)
    const device = await this.find(instance)
    this._assertRunning(device)
    const action = String(event.action || '')
    return this._locked(instance, async () => {
      switch (action) {
        case 'tap': {
          const x = clampInt(event.x, 0, 20000, 'x')
          const y = clampInt(event.y, 0, 20000, 'y')
          await this._run(['-instance', instance, '-click', String(x), String(y)], { timeout: this.timeout })
          return { action, x, y }
        }
        case 'swipe': {
          const x1 = clampInt(event.x1, 0, 20000, 'x1')
          const y1 = clampInt(event.y1, 0, 20000, 'y1')
          const x2 = clampInt(event.x2, 0, 20000, 'x2')
          const y2 = clampInt(event.y2, 0, 20000, 'y2')
          await this._run(['-instance', instance, '-slide', `${x1} ${y1} ${x2} ${y2}`], {
            timeout: this.timeout,
          })
          return { action, x1, y1, x2, y2 }
        }
        case 'rotate': {
          const direction = text(event.direction || 'right').toLowerCase()
          if (direction !== 'left' && direction !== 'right') {
            throw fail('bad-direction', '旋转方向只能是 left / right')
          }
          await this._run(['-instance', instance, '-rotation', direction], { timeout: this.timeout })
          return { action, direction }
        }
        case 'power': {
          await this._run(['-instance', instance, '-power'], { timeout: this.timeout })
          return { action }
        }
        case 'key':
        case 'text':
        case 'inputText': {
          const serial = await this._hdcSerial({ serial: event.serial })
          try {
            return await this.hdc.input(serial, event)
          } catch (error) {
            if (error.code !== 'unknown-device' && error.code !== 'device-not-ready') throw error
            this._emulatorSerial = null
            const retry = await this._hdcSerial({ fresh: true, serial: event.serial })
            return this.hdc.input(retry, event)
          }
        }
        default:
          throw fail('bad-action', `不支持的操作: ${action || '(empty)'}`)
      }
    })
  }

  /** 分辨率：来自实例详情，缓存 5 分钟（折叠屏可能有双屏字段，取 single 再回退 double）。 */
  async screenInfo(name, options = {}) {
    const instance = normalizeEmulatorName(name)
    const cached = this._screens.get(instance)
    const now = Date.now()
    if (!options.fresh && cached && now - cached.at < SCREEN_TTL) return cached.info
    const device = await this.find(instance)
    if (!device.width || !device.height) {
      throw fail('bad-screen-info', `模拟器 ${instance} 没有上报分辨率`)
    }
    const info = { width: device.width, height: device.height }
    this._screens.set(instance, { at: now, info })
    return info
  }

  async _locked(name, task) {
    const previous = this._locks.get(name) || Promise.resolve()
    const current = previous.then(task, task)
    const guarded = current.catch(() => {})
    this._locks.set(name, guarded)
    try {
      return await current
    } finally {
      if (this._locks.get(name) === guarded) this._locks.delete(name)
    }
  }
}
