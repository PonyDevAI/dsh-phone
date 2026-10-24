// dsh-phone · H.264 流（P1）
// `adb exec-out screenrecord --output-format=h264 -` 是 Annex-B 裸流，
// 这里只负责把子进程 stdout 原样 pipe 给 HTTP 响应，并管理生命周期：
// - 客户端断开 → kill 子进程
// - screenrecord 单次上限（默认 180s）→ 自动重启，客户端在下个 IDR 恢复
// - res.write 背压 → pause/resume 子进程 stdout
import { spawn } from 'node:child_process'

/** 清晰度预设：按设备实际显示的短边缩放，保持屏幕比例，不改手机分辨率。 */
export const STREAM_QUALITY = Object.freeze({
  low: { shortSide: 360, bitRate: 2_000_000 },
  medium: { shortSide: 540, bitRate: 6_000_000 },
  high: { shortSide: 720, bitRate: 10_000_000 },
})

/**
 * 按设备分辨率算出 screenrecord 的输出尺寸：等比缩放到目标短边、宽高取偶数。
 * 例如 Pixel 1080x2400 + 标准(540) => 540x1200；720x1280 => 540x960。
 */
export function streamSizeFor(info, shortSide) {
  const width = Number(info && info.width) || 0
  const height = Number(info && info.height) || 0
  if (width < 2 || height < 2) return null
  const short = Math.min(width, height)
  const scale = Math.min(1, shortSide / short)
  const even = (value, max) => {
    const rounded = Math.max(2, Math.round((value * scale) / 2) * 2)
    return Math.min(Math.floor(max / 2) * 2, rounded)
  }
  return { width: even(width, width), height: even(height, height) }
}

const DEFAULTS = {
  timeLimit: 180,
  bitRate: 6_000_000,
  size: '540x1200',
  restartDelayMs: 250,
}

export function createStreamer(adb, options = {}) {
  const config = { ...DEFAULTS, ...options }

  return {
    /**
     * 把某台设备的 H.264 流接到一个 HTTP 响应上。
     * 调用前必须先 adb.assertReady(serial)，这里不再重复校验。
     */
    open(serial, res, overrides = {}) {
      const size = overrides.size || config.size
      const bitRate = overrides.bitRate || config.bitRate
      let closed = false
      let child = null
      let restartTimer = null

      const stop = () => {
        if (closed) return
        closed = true
        if (restartTimer) clearTimeout(restartTimer)
        if (child) {
          try {
            child.kill('SIGTERM')
          } catch {}
        }
      }

      const start = () => {
        if (closed) return
        const args = [
          '-s',
          serial,
          'exec-out',
          'screenrecord',
          '--output-format=h264',
          '--time-limit=' + String(config.timeLimit),
          '--bit-rate=' + String(bitRate),
          '--size=' + size,
          '-',
        ]
        child = spawn(adb.bin, args, { stdio: ['ignore', 'pipe', 'ignore'] })
        if (!child.stdout) {
          stop()
          return
        }
        child.stdout.on('data', (chunk) => {
          if (closed) return
          const ok = res.write(chunk)
          if (!ok) {
            child.stdout.pause()
            res.once('drain', () => {
              if (!closed && child && child.stdout) child.stdout.resume()
            })
          }
        })
        child.stdout.on('error', stop)
        child.on('error', () => {
          if (closed) return
          restartTimer = setTimeout(start, 1000)
        })
        child.on('exit', () => {
          if (closed) return
          restartTimer = setTimeout(start, config.restartDelayMs)
        })
      }

      res.on('close', stop)
      res.on('error', stop)
      start()
      return stop
    },
  }
}
