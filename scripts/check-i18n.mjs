// 校验 client.js 里的 zh / en 字典键完全一致，并且源码里用到的 t('key') 都有定义。
// 不依赖浏览器：用桩把 ModuleLoader / React / document / ctx 折起来，跑一遍 apply 抓字典。
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let definition = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      definition = entry
    },
  },
}

const stub = () => undefined
const ReactStub = new Proxy(
  {},
  {
    get(target, key) {
      if (key === 'createElement') return () => null
      return stub
    },
  },
)

const dictionaries = {}
const safeEffect = (fn) => {
  try {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  } catch {
    return () => {}
  }
}
const ctx = {
  effect: safeEffect,
  locale: {
    register(namespace, value) {
      dictionaries[namespace] = value
      return () => {}
    },
    bind() {
      return (key) => key
    },
  },
  slots: {
    inject(slot, register) {
      try {
        register()
      } catch {
        /* 桩不执行真实注册 */
      }
      return () => {}
    },
    register() {
      return { options: {}, comp: () => null }
    },
  },
  sidebarRight: { openTab() {} },
  sidebarRightTabs: { register: () => () => {} },
}

globalThis.document = {
  createElement: () => ({ id: '', textContent: '', remove() {}, setAttribute() {} }),
  head: { appendChild() {}, removeChild() {} },
  querySelector: () => null,
}

await import('../lib/client.js?check-i18n')

if (!definition) {
  console.error('client.js 没有调用 window.__ModuleLoader__.load')
  process.exit(1)
}
const module = definition.factory((name) => {
  if (name === 'react' || name === 'react-dom') return ReactStub
  throw new Error('unexpected require: ' + name)
})
module.apply(ctx)

const dictionary = dictionaries['dsh-phone']
if (!dictionary || !dictionary.zh || !dictionary.en) {
  console.error('locale.register 没有抓到 zh / en 字典')
  process.exit(1)
}

const zh = Object.keys(dictionary.zh).sort()
const en = Object.keys(dictionary.en).sort()
const missingEn = zh.filter((key) => !(key in dictionary.en))
const missingZh = en.filter((key) => !(key in dictionary.zh))
const used = new Set()
for (const match of source.matchAll(/\bt\('([A-Za-z0-9_.-]+)'\)/g)) used.add(match[1])
const undefinedKeys = [...used].filter((key) => !(key in dictionary.zh))

let failures = 0
if (missingEn.length) {
  failures += 1
  console.error('en 缺少键: ' + missingEn.join(', '))
}
if (missingZh.length) {
  failures += 1
  console.error('zh 缺少键: ' + missingZh.join(', '))
}
// 允许少量仅内部使用的键，只要源码里用到就必须定义
for (const key of undefinedKeys) {
  failures += 1
  console.error("源码使用但字典缺少: t('" + key + "')")
}
if (failures > 0) process.exit(1)
console.log('i18n ok: ' + zh.length + ' keys, ' + used.size + ' used')
