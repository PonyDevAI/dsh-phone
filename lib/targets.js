// dsh-phone · 连接目标收藏（$DSH_HOME/phone/targets.json）
// 只存地址和最近使用时间，不存任何凭据；文件权限 600。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ADDRESS_RE } from './adb.js'

const LIMIT = 12

export function createTargetStore(file) {
  let cache = null

  async function load() {
    if (cache !== null) return cache
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      const raw = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.targets) ? parsed.targets : []
      cache = raw.filter((item) => item && typeof item.address === 'string' && ADDRESS_RE.test(item.address))
    } catch {
      cache = []
    }
    return cache
  }

  async function persist(list) {
    cache = list.slice(0, LIMIT)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ version: 1, targets: cache }, null, 2) + '\n', { mode: 0o600 })
  }

  return {
    async list() {
      return [...(await load())]
    },
    /** 连接成功后记录最近使用（去重、置顶、最多 12 条）。 */
    async record(address) {
      if (typeof address !== 'string' || !ADDRESS_RE.test(address)) return null
      const list = await load()
      const index = list.findIndex((item) => item.address === address)
      const entry = {
        address,
        lastSeenAt: Date.now(),
        pinned: index >= 0 ? list[index].pinned === true : false,
      }
      if (index >= 0) list.splice(index, 1)
      list.unshift(entry)
      await persist(list)
      return entry
    },
    async remove(address) {
      const list = await load()
      await persist(list.filter((item) => item.address !== address))
      return true
    },
  }
}
