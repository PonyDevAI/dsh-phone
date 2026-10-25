// dsh-phone · Host 半区
// - 挂 /phone 前缀路由（webServer.register + connection.admit 认证围栏）
// - 纯 JSON 协议：POST /phone/<endpoint> → { ok: true, value } | { ok: false, error }
// - 截图例外：成功时直接回 image/png 原始字节
// - 不暴露任意 adb shell；serial 必须在最新 adb devices 列表里
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createTransports } from './transport.js'
import { createTargetStore } from './targets.js'
import { STREAM_QUALITY, createStreamer, streamSizeFor } from './stream.js'
import { IosSimulator } from './ios.js'
import { HarmonyEmulator, HarmonyHdc } from './hos.js'

export const name = 'dsh-phone'

const DEFAULTS = {
  adbPath: 'adb',
  xcrun: 'xcrun',
  idb: 'idb',
  hdcPath: 'hdc',
  emulatorPath: '',
  pollMs: 700,
  streamTimeLimit: 180,
  streamBitRate: 6_000_000,
  streamSize: '540x1200',
}

function messageOf(error) {
  const text = error && error.message ? String(error.message) : '未知错误'
  return text.length > 400 ? text.slice(0, 400) : text
}

function failOf(error) {
  const code = error && typeof error.code === 'string' ? error.code : 'phone/error'
  return { ok: false, error: { code, message: messageOf(error) } }
}

function readBody(req, cap = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res, code, payload) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig || {}) }
  const { adb } = createTransports({ adbPath: config.adbPath })
  const ios = new IosSimulator({ xcrun: config.xcrun, idb: config.idb })
  const hdc = new HarmonyHdc({ path: config.hdcPath })
  const hosEmulator = new HarmonyEmulator({ path: config.emulatorPath, hdc })
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh')
  const targets = createTargetStore(join(home, 'phone', 'targets.json'))
  const streamer = createStreamer(adb, {
    timeLimit: config.streamTimeLimit,
    bitRate: config.streamBitRate,
    size: config.streamSize,
  })

  const ok = (value) => ({ ok: true, value })
  const fail = (code, message) => {
    const error = new Error(message)
    error.code = code
    return error
  }

  async function listAllDevices() {
    const [adbResult, iosResult, emulatorResult, hdcResult] = await Promise.allSettled([
      adb.devices({ fresh: true }),
      ios.list(),
      hosEmulator.list(),
      hdc.list(),
    ])
    const devices = []
    if (adbResult.status === 'fulfilled') devices.push(...adbResult.value.devices)
    if (iosResult.status === 'fulfilled') devices.push(...iosResult.value)
    if (emulatorResult.status === 'fulfilled') devices.push(...emulatorResult.value)
    if (hdcResult.status === 'fulfilled') devices.push(...hdcResult.value)
    return devices
  }

  async function resolveDevice(serial) {
    const devices = await listAllDevices()
    const device = devices.find((item) => item.serial === serial)
    if (!device) throw fail('unknown-device', `设备 ${serial} 不在当前设备列表里`)
    const kind =
      device.transport === 'simctl'
        ? 'ios'
        : device.transport === 'emulator'
          ? 'emulator'
          : device.transport === 'hdc'
            ? 'hdc'
            : 'adb'
    return { kind, device }
  }

  async function handle(endpoint, payload) {
    switch (endpoint) {
      case 'health': {
        let adbInfo = null
        let adbError = null
        try {
          adbInfo = await adb.resolve()
        } catch (error) {
          adbError = messageOf(error)
        }
        const devices = await listAllDevices().catch(() => [])
        const iosAvailable = await ios.available().catch(() => false)
        const idbAvailable = iosAvailable ? await ios.idbAvailable().catch(() => false) : false
        let emulatorInfo = null
        try {
          emulatorInfo = await hosEmulator.resolve()
        } catch {}
        let hdcInfo = null
        try {
          hdcInfo = await hdc.resolve()
        } catch {}
        return ok({
          adb: adbInfo,
          adbError,
          devices: devices.length,
          ios: { available: iosAvailable, idb: idbAvailable, version: ios.idbVersion },
          harmony: {
            emulator: { available: Boolean(emulatorInfo), version: emulatorInfo ? emulatorInfo.version : null },
            hdc: { available: Boolean(hdcInfo), version: hdcInfo ? hdcInfo.version : null },
          },
        })
      }
      case 'devices': {
        const devices = await listAllDevices()
        return ok({ devices, at: Date.now() })
      }
      case 'connect': {
        const result = await adb.connect(String(payload.address || ''))
        await targets.record(result.address)
        return ok(result)
      }
      case 'targets':
        return ok({ targets: await targets.list() })
      case 'targets/remove':
        return ok({ removed: await targets.remove(String(payload.address || '')) })
      case 'ping': {
        const serial = String(payload.serial || '')
        const { kind } = await resolveDevice(serial)
        if (kind === 'ios') return ok(await ios.ping(serial))
        if (kind === 'emulator') {
          const started = process.hrtime.bigint()
          await hosEmulator.find(serial)
          return ok({ ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6), at: Date.now() })
        }
        if (kind === 'hdc') {
          const started = process.hrtime.bigint()
          await hdc.assertReady(serial)
          return ok({ ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6), at: Date.now() })
        }
        return ok(await adb.ping(serial))
      }
      case 'screen-info': {
        const serial = String(payload.serial || '')
        const { kind } = await resolveDevice(serial)
        if (kind === 'ios') return ok(await ios.screenInfo(serial))
        if (kind === 'emulator') return ok(await hosEmulator.screenInfo(serial, { fresh: payload.fresh === true }))
        if (kind === 'hdc') return ok(await hdc.screenInfo(serial, { fresh: payload.fresh === true }))
        return ok(await adb.screenInfo(serial, { fresh: payload.fresh === true }))
      }
      case 'disconnect':
        return ok(await adb.disconnect(String(payload.serial || '')))
      case 'input': {
        const serial = String(payload.serial || '')
        const { kind } = await resolveDevice(serial)
        if (kind === 'ios') return ok(await ios.input(serial, payload.event || {}))
        if (kind === 'emulator') return ok(await hosEmulator.input(serial, payload.event || {}))
        if (kind === 'hdc') return ok(await hdc.input(serial, payload.event || {}))
        return ok(await adb.input(serial, payload.event || {}))
      }
      case 'ios/types':
        return ok({ types: await ios.listDeviceTypes() })
      case 'ios/runtimes':
        return ok({ runtimes: await ios.listRuntimes() })
      case 'ios/create':
        return ok(await ios.create({ name: String(payload.name || ''), deviceType: String(payload.deviceType || ''), runtime: String(payload.runtime || '') }))
      case 'ios/boot':
        return ok(await ios.boot(String(payload.serial || '')))
      case 'ios/shutdown':
        return ok(await ios.shutdown(String(payload.serial || '')))
      case 'ios/delete':
        return ok(await ios.remove(String(payload.serial || '')))
      case 'hos/images':
        return ok({ images: await hosEmulator.imageList({ deviceType: String(payload.deviceType || 'phone') }) })
      case 'hos/create':
        return ok(
          await hosEmulator.create({
            name: String(payload.name || ''),
            osVersion: String(payload.osVersion || ''),
            deviceType: String(payload.deviceType || 'phone'),
          }),
        )
      case 'hos/start':
        return ok(await hosEmulator.start(String(payload.serial || '')))
      case 'hos/stop':
        return ok(await hosEmulator.stop(String(payload.serial || '')))
      case 'hos/delete':
        return ok(await hosEmulator.remove(String(payload.serial || '')))
      default:
        return { ok: false, error: { code: 'phone/not-found', message: `未知接口: ${endpoint || '(empty)'}` } }
    }
  }

  ctx.inject(['connection', 'webServer'], (scope) => {
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'prefix',
          path: '/phone',
          handler: async (req, res) => {
            const admission = scope.connection.admit(req)
            if ('rejection' in admission) {
              res.writeHead(admission.rejection)
              res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
              return
            }
            const pathname = String(req.url || '/').split('?')[0]
            const endpoint = pathname.replace(/^\/phone\/?/, '').replace(/\/+$/, '')
            if (req.method !== 'POST') {
              json(res, 405, { ok: false, error: { code: 'phone/method', message: '只接受 POST' } })
              return
            }
            let payload = {}
            try {
              payload = JSON.parse((await readBody(req)) || '{}')
            } catch {
              json(res, 400, { ok: false, error: { code: 'phone/bad-body', message: '请求体不是 JSON' } })
              return
            }
            if (endpoint === 'stream') {
              const serial = String(payload.serial || '')
              let resolved = null
              try {
                resolved = await resolveDevice(serial)
              } catch (error) {
                json(res, 200, failOf(error))
                return
              }
              if (resolved.kind === 'emulator' || resolved.kind === 'hdc') {
                json(res, 200, failOf(fail('stream-unsupported', '鸿蒙暂不支持实时流，回退截图轮询')))
                return
              }
              if (resolved.kind === 'ios') {
                if (!(await ios.idbAvailable())) {
                  json(res, 200, failOf(fail('idb-missing', 'iOS 实时画面需要 idb（brew install facebook/fb/idb-companion + pip install fb-idb）')))
                  return
                }
                res.writeHead(200, {
                  'content-type': 'video/h264',
                  'cache-control': 'no-store',
                  'x-content-type-options': 'nosniff',
                  'x-accel-buffering': 'no',
                })
                if (typeof res.flushHeaders === 'function') res.flushHeaders()
                ios.openStream(serial, res, {}).catch(() => {
                  try {
                    res.end()
                  } catch {}
                })
                return
              }
              try {
                await adb.assertReady(serial)
              } catch (error) {
                json(res, 200, failOf(error))
                return
              }
              res.writeHead(200, {
                'content-type': 'video/h264',
                'cache-control': 'no-store',
                'x-content-type-options': 'nosniff',
                'x-accel-buffering': 'no',
              })
              if (typeof res.flushHeaders === 'function') res.flushHeaders()
              const preset = STREAM_QUALITY[String(payload.quality || '')]
              let openOptions = {}
              if (preset) {
                openOptions = { bitRate: preset.bitRate }
                try {
                  const info = await adb.screenInfo(serial, { fresh: true })
                  const dims = streamSizeFor(info, preset.shortSide)
                  if (dims) openOptions.size = dims.width + 'x' + dims.height
                } catch {}
              }
              streamer.open(serial, res, openOptions)
              return
            }
            if (endpoint === 'shot') {
              try {
                const serial = String(payload.serial || '')
                const { kind } = await resolveDevice(serial)
                const buffer =
                  kind === 'ios'
                    ? await ios.shot(serial)
                    : kind === 'emulator'
                      ? await hosEmulator.shot(serial)
                      : kind === 'hdc'
                        ? await hdc.shot(serial)
                        : await adb.shot(serial)
                res.writeHead(200, {
                  'content-type': 'image/png',
                  'content-length': buffer.length,
                  'cache-control': 'no-store',
                })
                res.end(buffer)
              } catch (error) {
                json(res, 200, failOf(error))
              }
              return
            }
            try {
              json(res, 200, await handle(endpoint, payload))
            } catch (error) {
              json(res, 200, failOf(error))
            }
          },
        }),
      'dsh-phone: route',
    )
  })
}
