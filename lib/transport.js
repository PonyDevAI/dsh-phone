// dsh-phone · transport 层
// 把「设备从哪来、画面怎么取、输入怎么发」抽成一个接口。
// 现在只有 adb；以后加 hdc（鸿蒙）或 iOS（idb / WDA）时，各实现一个 transport，UI 不变。
//
// interface PhoneTransport {
//   id: 'adb' | 'hdc' | 'ios'
//   label: string
//   resolve(): Promise<unknown>
//   list(): Promise<Device[]>
//   connect(target: string): Promise<unknown>
//   disconnect(serial: string): Promise<unknown>
//   shot(serial: string): Promise<Buffer>
//   input(serial: string, event: object): Promise<unknown>
// }
import { Adb } from './adb.js'

export class AdbTransport {
  constructor(adb) {
    this.id = 'adb'
    this.label = 'adb'
    this.adb = adb
  }

  resolve() {
    return this.adb.resolve()
  }

  async list() {
    const { devices } = await this.adb.devices()
    return devices.map((device) => ({ ...device, transport: this.id }))
  }

  connect(address) {
    return this.adb.connect(address)
  }

  disconnect(serial) {
    return this.adb.disconnect(serial)
  }

  shot(serial) {
    return this.adb.shot(serial)
  }

  input(serial, event) {
    return this.adb.input(serial, event)
  }
}

export function createTransports(options = {}) {
  const adb = new Adb({ path: options.adbPath })
  const transports = new Map()
  transports.set('adb', new AdbTransport(adb))
  return { adb, transports }
}
