// dsh-phone · Host 半区
// - 挂 /phone 前缀路由（webServer.register + connection.admit 认证围栏）
// - 纯 JSON 协议：POST /phone/<endpoint> → { ok: true, value } | { ok: false, error }
// - 截图例外：成功时直接回 image/png 原始字节
// - 不暴露任意 adb shell；serial 必须在最新 adb devices 列表里
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createTransports } from './transport.js'
import { createTargetStore } from './targets.js'
import { createStreamer } from './stream.js'

export const name = 'dsh-phone'

const DEFAULTS = {
  adbPath: 'adb',
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
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh')
  const targets = createTargetStore(join(home, 'phone', 'targets.json'))
  const streamer = createStreamer(adb, {
    timeLimit: config.streamTimeLimit,
    bitRate: config.streamBitRate,
    size: config.streamSize,
  })

  const ok = (value) => ({ ok: true, value })

  async function handle(endpoint, payload) {
    switch (endpoint) {
      case 'health': {
        try {
          const info = await adb.resolve()
          const { devices } = await adb.devices()
          return ok({ adb: info, devices: devices.length })
        } catch (error) {
          return ok({ adb: null, devices: 0, error: messageOf(error) })
        }
      }
      case 'devices': {
        const { devices, at } = await adb.devices({ fresh: true })
        return ok({ devices, at })
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
      case 'screen-info':
        return ok(await adb.screenInfo(String(payload.serial || '')))
      case 'disconnect':
        return ok(await adb.disconnect(String(payload.serial || '')))
      case 'input':
        return ok(await adb.input(String(payload.serial || ''), payload.event || {}))
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
              streamer.open(serial, res)
              return
            }
            if (endpoint === 'shot') {
              try {
                const buffer = await adb.shot(String(payload.serial || ''))
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
