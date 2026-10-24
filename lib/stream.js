// dsh-phone · H.264 流（P1）
// `adb exec-out screenrecord --output-format=h264 -` 是 Annex-B 裸流，
// 这里只负责把子进程 stdout 原样 pipe 给 HTTP 响应，并管理生命周期：
// - 客户端断开 → kill 子进程
// - screenrecord 单次上限（默认 180s）→ 自动重启，客户端在下个 IDR 恢复
// - res.write 背压 → pause/resume 子进程 stdout
import { spawn } from 'node:child_process'

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
    open(serial, res) {
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
          '--bit-rate=' + String(config.bitRate),
          '--size=' + config.size,
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
