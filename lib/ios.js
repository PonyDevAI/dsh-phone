// dsh-phone · iOS 模拟器 transport
// - 生命周期/创建/截图：公开的 xcrun simctl
// - 实时画面 + 输入：idb（Meta 的 FBSimulatorControl CLI，Claude Code 桌面版内部也是这套私有 CoreSimulator/SimulatorKit 栈）
// 没有 idb 时降级为「截图轮询 + 只读」，输入会明确报 idb-missing。
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_TIMEOUT = 20000
const SHOT_TIMEOUT = 20000

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function run(bin, args, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT
  const maxBuffer = options.maxBuffer || 16 * 1024 * 1024
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer, windowsHide: true, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) {
        const text = (stderr && stderr.toString('utf8').trim()) || (stdout && stdout.toString('utf8').trim()) || error.message
        const wrapped = fail(options.code || 'ios-command-failed', text.split(/\r?\n/).slice(0, 3).join(' '))
        wrapped.stdout = stdout
        wrapped.stderr = stderr
        reject(wrapped)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function pngSize(buffer) {
  if (!buffer || buffer.length < 24) return null
  if (buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    return null
  }
}

export class IosSimulator {
  constructor(options = {}) {
    this.xcrun = options.xcrun || 'xcrun'
    this.idbBin = options.idb || 'idb'
    this.idbChecked = null
    this.idbVersion = null
    this._screens = new Map()
    this._streams = new Map()
  }

  async simctl(args, options = {}) {
    return run(this.xcrun, ['simctl', ...args], options)
  }

  async available() {
    try {
      await this.simctl(['list', 'devices', '--json'], { timeout: 8000 })
      return true
    } catch {
      return false
    }
  }

  async idbAvailable() {
    if (this.idbChecked !== null) return this.idbChecked
    try {
      const { stdout } = await run(this.idbBin, ['--help'], { timeout: 8000 })
      const text = stdout.toString('utf8')
      if (!/idb:/.test(text)) throw fail('idb-missing', 'idb --help 输出异常')
      this.idbVersion = 'fb-idb'
      this.idbChecked = true
    } catch {
      this.idbChecked = false
    }
    return this.idbChecked
  }

  async list() {
    const { stdout } = await this.simctl(['list', 'devices', '--json'])
    const data = parseJson(stdout)
    if (!data || !data.devices) throw fail('ios-list-failed', '无法解析 simctl list devices')
    const runtimes = new Map()
    try {
      const { stdout: rtOut } = await this.simctl(['list', 'runtimes', '--json'])
      const rt = parseJson(rtOut)
      for (const item of (rt && rt.runtimes) || []) runtimes.set(item.identifier, item.name)
    } catch {}
    const devices = []
    for (const [runtimeId, list] of Object.entries(data.devices)) {
      for (const item of list || []) {
        if (!item || !item.udid) continue
        if (item.isAvailable === false) continue
        devices.push({
          serial: item.udid,
          state: item.state === 'Booted' ? 'device' : 'offline',
          model: item.name,
          platform: 'ios',
          kind: 'simulator',
          transport: 'simctl',
          runtime: runtimes.get(runtimeId) || runtimeId,
          booted: item.state === 'Booted',
        })
      }
    }
    return devices
  }

  async listDeviceTypes() {
    const { stdout } = await this.simctl(['list', 'devicetypes', '--json'])
    const data = parseJson(stdout)
    return ((data && data.devicetypes) || [])
      .filter((item) => /^(iPhone|iPad)/.test(item.name))
      .map((item) => ({ identifier: item.identifier, name: item.name }))
  }

  async listRuntimes() {
    const { stdout } = await this.simctl(['list', 'runtimes', '--json'])
    const data = parseJson(stdout)
    return ((data && data.runtimes) || [])
      .filter((item) => item.isAvailable !== false && /iOS/i.test(item.name))
      .map((item) => ({ identifier: item.identifier, name: item.name, version: item.version }))
  }

  async create({ name, deviceType, runtime }) {
    if (!name || !deviceType || !runtime) throw fail('ios-create-bad-request', 'name / deviceType / runtime 都必填')
    const { stdout } = await this.simctl(['create', String(name), String(deviceType), String(runtime)])
    const udid = stdout.toString('utf8').trim()
    if (!udid) throw fail('ios-create-failed', 'simctl create 没有返回 UDID')
    await this.boot(udid)
    return { serial: udid, name }
  }

  async boot(udid) {
    try {
      await this.simctl(['boot', udid], { timeout: 60000 })
    } catch (error) {
      const message = String(error.message || '')
      if (!/already booted|current state: Booted/i.test(message)) throw error
    }
    return true
  }

  async shutdown(udid) {
    await this.simctl(['shutdown', udid], { timeout: 30000 })
    return true
  }

  async remove(udid) {
    await this.simctl(['delete', udid], { timeout: 30000 })
    return true
  }

  async shot(udid) {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-phone-ios-'))
    const file = join(dir, 'shot.png')
    try {
      await this.simctl(['io', udid, 'screenshot', file], { timeout: SHOT_TIMEOUT })
      const buffer = await readFile(file)
      if (!buffer.length) throw fail('ios-shot-failed', '模拟器截图是空的')
      return buffer
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async screenInfo(udid) {
    const cached = this._screens.get(udid)
    const now = Date.now()
    if (cached && now - cached.at < 60000) return cached.info
    const buffer = await this.shot(udid)
    const size = pngSize(buffer)
    if (!size) throw fail('ios-screen-info-failed', '无法读取模拟器截图尺寸')
    const scale = await this.scale(udid)
    const info = { width: size.width, height: size.height, scale, at: now }
    this._screens.set(udid, { at: now, info })
    return info
  }

  /** idb describe 里拿 point 尺寸/scale；没有 idb 时返回 null。 */
  async scale(udid) {
    if (!(await this.idbAvailable())) return null
    const cached = this._scales && this._scales.get(udid)
    if (cached && Date.now() - cached.at < 60000) return cached.value
    try {
      const { stdout } = await run(this.idbBin, ['describe', '--udid', udid], { timeout: 10000 })
      const text = stdout.toString('utf8')
      const match = /screen_dimensions=ScreenDimensions\(width=(\d+), height=(\d+), density=([\d.]+)/.exec(text)
      if (match) {
        const value = Number(match[3]) || null
        if (!this._scales) this._scales = new Map()
        this._scales.set(udid, { at: Date.now(), value })
        return value
      }
    } catch {}
    return null
  }

  async idb(args, options = {}) {
    if (!(await this.idbAvailable())) {
      throw fail('idb-missing', 'iOS 输入/实时画面需要 idb：brew trust --formula facebook/fb/idb-companion && brew install facebook/fb/idb-companion && python3 -m pip install --user fb-idb')
    }
    return run(this.idbBin, args, options)
  }

  async ping(udid) {
    const started = process.hrtime.bigint()
    try {
      await this.simctl(['list', 'devices', '--json'], { timeout: 5000 })
    } catch {}
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    return { ms: Math.round(ms), at: Date.now() }
  }

  async input(udid, event = {}) {
    const info = await this.screenInfo(udid)
    const scale = info.scale || 1
    const point = (value) => Math.round(Number(value) / scale)
    const action = String(event.action || '')
    switch (action) {
      case 'tap': {
        await this.idb(['ui', 'tap', '--udid', udid, String(point(event.x)), String(point(event.y))], { timeout: 8000 })
        return { action }
      }
      case 'swipe': {
        await this.idb(
          ['ui', 'swipe', '--udid', udid, String(point(event.x1)), String(point(event.y1)), String(point(event.x2)), String(point(event.y2))],
          { timeout: 10000 },
        )
        return { action }
      }
      case 'key': {
        const key = String(event.key || '')
        if (key === 'home') {
          await this.idb(['ui', 'button', '--udid', udid, 'HOME'], { timeout: 8000 })
          return { action, key }
        }
        if (key === 'back') {
          // iOS 没有返回键：从左边缘右滑（系统返回手势）
          await this.idb(
            ['ui', 'swipe', '--udid', udid, '1', String(Math.round(info.height / scale / 2)), '300', String(Math.round(info.height / scale / 2))],
            { timeout: 8000 },
          )
          return { action, key }
        }
        if (key === 'recents') {
          // 上滑（回到桌面/进入多任务）
          await this.idb(
            [
              'ui',
              'swipe',
              '--udid',
              udid,
              String(Math.round(info.width / scale / 2)),
              String(Math.round(info.height / scale - 40)),
              String(Math.round(info.width / scale / 2)),
              String(Math.round(info.height / scale / 2)),
            ],
            { timeout: 8000 },
          )
          return { action, key }
        }
        throw fail('ios-key-unsupported', `iOS 不支持按键: ${key}`)
      }
      case 'rotate': {
        // idb 没有旋转命令，用 simctl 的 io 端口做不了；交给 UI 侧暂不支持
        throw fail('ios-rotate-unsupported', 'iOS 模拟器旋转暂未实现')
      }
      default:
        throw fail('ios-input-unsupported', `iOS 不支持操作: ${action || '(empty)'}`)
    }
  }

  /** 实时流：idb video-stream 输出 Annex-B H.264，直接复用客户端的 WebCodecs 管线。 */
  async openStream(udid, res, options = {}) {
    if (!(await this.idbAvailable())) {
      throw fail('idb-missing', 'iOS 实时画面需要 idb（brew install facebook/fb/idb-companion + pip install fb-idb）')
    }
    const fps = String(options.fps || 30)
    const args = ['video-stream', '--format', 'h264', '--fps', fps, '--compression-quality', '0.8', '--udid', udid]
    let closed = false
    let child = null
    const start = () => {
      if (closed) return
      child = spawn(this.idbBin, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      if (!child.stdout) {
        closed = true
        return
      }
      child.stdout.on('data', (chunk) => {
        if (closed) return
        if (!res.write(chunk)) {
          child.stdout.pause()
          res.once('drain', () => {
            if (!closed && child && child.stdout) child.stdout.resume()
          })
        }
      })
      child.stdout.on('error', stop)
      child.on('exit', () => {
        if (!closed) setTimeout(start, 300)
      })
    }
    const stop = () => {
      if (closed) return
      closed = true
      if (child) {
        try {
          child.kill('SIGTERM')
        } catch {}
      }
    }
    res.on('close', stop)
    res.on('error', stop)
    start()
    return stop
  }
}
