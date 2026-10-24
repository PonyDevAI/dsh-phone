// dsh-phone · Client 半区（手写 ModuleLoader bundle，无构建步骤）
// - 右侧栏 tab「手机」：设备列表 / 设备画面
// - 会话头部手机图标：点一下展开右侧栏
// - 画面：轮询 /phone/shot（PNG），点击 = tap，拖拽 = swipe
// - 没有分辨率/网速元数据栏，没有文字输入框
window.__ModuleLoader__.load({
  id: 'dsh-phone',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'dsh-phone'

    // ---------------------------------------------------------------- i18n
    const zh = {
      title: '手机',
      desc: '预览并点按已连接的 Android 设备',
      devices: '设备',
      connected: '已连接',
      cloud: '云手机',
      select: '选择设备',
      refresh: '刷新',
      add: '连接设备',
      address: '地址（ip:port）',
      cancel: '取消',
      connect: '连接',
      connecting: '连接中…',
      empty: '没有已连接的设备',
      noAdb: '未找到 adb：请安装 Android platform-tools，或在 cordis.patch.yml 里设置 adbPath',
      waitingHost: '正在等待宿主接口 /phone… 重启 dsh web 后可用',
      retry: '重试',
      loading: '载入中…',
      shotFailed: '画面获取失败',
      unauthorized: '未授权',
      offline: '离线',
      back: '返回',
      home: '主页',
      recents: '多任务',
      screenshot: '截图',
      more: '更多',
      power: '电源',
      rotate: '旋转',
      reconnect: '重新连接',
      disconnect: '断开连接',
      copySerial: '复制序列号',
      copied: '已复制',
      saved: '截图已保存',
      listHint: '点设备预览画面',
      float: '浮窗打开',
      saved: '已保存',
      diagnostics: 'adb 诊断',
      noSaved: '还没有保存的连接目标',
      copyDiag: '复制诊断信息',
      remove: '移除',
      diagHint: '连接失败时先看这里：未授权要去手机上点允许，offline 要重新 connect。',
      unauthorizedHint: '在手机上点「允许 USB 调试」后重试',
    }
    const en = {
      title: 'Phone',
      desc: 'Preview and tap a connected Android device',
      devices: 'Devices',
      connected: 'Connected',
      cloud: 'Cloud phones',
      select: 'Select device',
      refresh: 'Refresh',
      add: 'Connect device',
      address: 'Address (ip:port)',
      cancel: 'Cancel',
      connect: 'Connect',
      connecting: 'Connecting…',
      empty: 'No connected devices',
      noAdb: 'adb not found. Install Android platform-tools or set adbPath in cordis.patch.yml',
      waitingHost: 'Waiting for the host API /phone… restart dsh web',
      retry: 'Retry',
      loading: 'Loading…',
      shotFailed: 'Could not fetch the screen',
      unauthorized: 'Unauthorized',
      offline: 'Offline',
      back: 'Back',
      home: 'Home',
      recents: 'Recents',
      screenshot: 'Screenshot',
      more: 'More',
      power: 'Power',
      rotate: 'Rotate',
      reconnect: 'Reconnect',
      disconnect: 'Disconnect',
      copySerial: 'Copy serial',
      copied: 'Copied',
      saved: 'Screenshot saved',
      listHint: 'Pick a device to preview',
      float: 'Open as floating window',
      saved: 'Saved',
      diagnostics: 'adb diagnostics',
      noSaved: 'No saved targets yet',
      copyDiag: 'Copy diagnostics',
      remove: 'Remove',
      diagHint: 'If connecting fails: authorize USB debugging on the phone; reconnect offline devices.',
      unauthorizedHint: 'Allow USB debugging on the phone, then retry',
    }

    // ---------------------------------------------------------------- styles
    const CSS = `
.dph-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#17171a);font-size:13px;line-height:1.45}
.dph-bar{height:42px;flex:none;display:flex;align-items:center;gap:2px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#e9e9ec)}
.dph-grow{flex:1 1 auto}
.dph-ibtn{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6f6f76);display:inline-grid;place-items:center;cursor:pointer;padding:0}
.dph-ibtn:hover{background:var(--dsw-alias-bg-layer-2,#f4f4f5);color:var(--dsw-alias-label-primary,#17171a)}
.dph-ibtn:active{transform:scale(.94)}
.dph-select{height:28px;max-width:230px;display:flex;align-items:center;gap:7px;padding:0 8px;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f4f4f5);color:var(--dsw-alias-label-primary,#17171a);font-size:12.5px;cursor:pointer}
.dph-select:hover{background:var(--dsw-alias-bg-layer-2,#ececef)}
.dph-select .nm{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dph-select .chev{color:var(--dsw-alias-label-tertiary,#9a9aa1);flex:none}
.dph-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}

.dph-list{flex:1 1 auto;min-height:0;padding:6px 10px 14px;overflow:auto}
.dph-group{padding:12px 10px 5px;font-size:11px;letter-spacing:.4px;color:var(--dsw-alias-label-tertiary,#9a9aa1);display:flex;align-items:center;gap:8px}
.dph-group:after{content:"";flex:1;height:1px;background:var(--dsw-alias-border-l1,#e9e9ec)}
.dph-row{display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;border:0;border-radius:10px;background:transparent;text-align:left;cursor:pointer;color:inherit;font:inherit}
.dph-row:hover{background:var(--dsw-alias-bg-layer-2,#f4f4f5)}
.dph-row.sel{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b6cff) 8%,transparent)}
.dph-av{width:32px;height:32px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#f1f1f3);display:grid;place-items:center;color:var(--dsw-alias-label-secondary,#4b4b52);flex:none;position:relative}
.dph-av .on{position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border-radius:50%;border:2px solid var(--dsw-alias-bg-layer-1,#fff);background:var(--dsw-alias-state-success-primary,#22c55e)}
.dph-av .warn{background:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dph-av .off{background:var(--dsw-alias-label-tertiary,#9a9aa1)}
.dph-meta{display:block;min-width:0;flex:1}
.dph-model{font-size:13px;font-weight:500;display:flex;align-items:center;gap:7px}
.dph-tag{font-size:10px;font-weight:500;color:var(--dsw-alias-label-secondary,#6f6f76);background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,#e9e9ec);border-radius:5px;padding:1px 5px}
.dph-serial{display:block;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary,#9a9aa1);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dph-state{font-size:11px;color:var(--dsw-alias-state-warn-primary,#b45309);flex:none}
.dph-state.saved{color:var(--dsw-alias-label-tertiary,#9a9aa1)}
.dph-chev{color:var(--dsw-alias-label-tertiary,#9a9aa1);flex:none}
.dph-emptypadding{padding:26px 20px;color:var(--dsw-alias-label-tertiary,#9a9aa1);font-size:12.5px;line-height:1.7}
.dph-link{color:var(--dsw-alias-brand-primary,#3b6cff);cursor:pointer;background:none;border:0;padding:0;font:inherit}

.dph-stage{flex:1 1 auto;min-height:0;background:var(--dsw-alias-bg-layer-2,#f2f2f4);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.dph-phone{position:relative;border-radius:42px;background:#0b0b0d;padding:9px;box-sizing:border-box;box-shadow:inset 0 0 0 1.5px #2c2c31,inset 0 0 0 4px #050506,0 24px 48px rgba(0,0,0,.24)}
.dph-phone:before{content:"";position:absolute;left:-3px;top:118px;width:3px;height:84px;border-radius:2px;background:#232327}
.dph-phone:after{content:"";position:absolute;right:-3px;top:132px;width:3px;height:54px;border-radius:2px;background:#232327}
.dph-screen{position:relative;width:100%;height:100%;border-radius:34px;overflow:hidden;background:#101014}
.dph-screen img{display:block;width:100%;height:100%;object-fit:fill;user-select:none;-webkit-user-drag:none;touch-action:none;cursor:pointer}
.dph-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(16,16,20,.72);color:#fff;font-size:12px;text-align:center;padding:18px}
.dph-overlay .msg{max-width:220px;line-height:1.6;opacity:.92}
.dph-btn{height:28px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:12px}
.dph-btn:hover{background:rgba(255,255,255,.2)}
.dph-spin{width:20px;height:20px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:dphspin .9s linear infinite}
@keyframes dphspin{to{transform:rotate(360deg)}}

.dph-backdrop{position:absolute;inset:0;z-index:20;background:transparent}
.dph-menu{position:absolute;z-index:21;top:40px;left:8px;width:330px;max-height:calc(100% - 56px);overflow:auto;padding:6px;border:1px solid var(--dsw-alias-border-l1,#e3e4e8);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 16px 40px rgba(0,0,0,.16)}
.dph-menu .dph-row{padding:8px}
.dph-menu-foot{border-top:1px solid var(--dsw-alias-border-l1,#eee);margin-top:4px;padding:6px 8px 2px;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#9a9aa1)}
.dph-connect{position:absolute;z-index:21;top:48px;left:8px;right:8px;max-width:340px;padding:14px;border:1px solid var(--dsw-alias-border-l1,#e3e4e8);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 16px 40px rgba(0,0,0,.16)}
.dph-connect .ttl{font-size:13px;font-weight:600;margin-bottom:2px}
.dph-connect .sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#9a9aa1);margin-bottom:10px}
.dph-field{display:flex;gap:8px}
.dph-input{flex:1;height:32px;border:1px solid var(--dsw-alias-border-l2,#dededf);border-radius:8px;padding:0 10px;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary,#17171a);background:var(--dsw-alias-bg-layer-1,#fff);outline:none}
.dph-input:focus{border-color:var(--dsw-alias-brand-primary,#3b6cff)}
.dph-primary{height:32px;padding:0 14px;border:0;border-radius:8px;background:var(--dsw-alias-label-primary,#17171a);color:var(--dsw-alias-bg-layer-1,#fff);font-size:12px;cursor:pointer}
.dph-primary:disabled{opacity:.5;cursor:default}
.dph-err{color:var(--dsw-alias-state-error-primary,#dc2626);font-size:11.5px;margin-top:8px;word-break:break-word}
.dph-toast{position:absolute;z-index:30;left:50%;bottom:18px;transform:translateX(-50%);max-width:80%;padding:6px 12px;border-radius:8px;background:rgba(23,23,26,.88);color:#fff;font-size:11.5px;pointer-events:none}
.dph-menu-list{display:block;max-height:320px;overflow:auto}
.dph-saved{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l1,#eee);padding-top:10px}
.dph-saved-title{font-size:11px;color:var(--dsw-alias-label-tertiary,#9a9aa1);letter-spacing:.3px;margin-bottom:6px}
.dph-saved-row{display:flex;align-items:center;gap:10px;padding:5px 2px}
.dph-saved-addr{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary,#6f6f76);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dph-saved-empty{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#9a9aa1);line-height:1.6;margin-bottom:10px}
.dph-link-muted{color:var(--dsw-alias-label-tertiary,#9a9aa1)}
.dph-diag{position:absolute;z-index:21;top:48px;left:8px;right:8px;max-width:420px;padding:14px;border:1px solid var(--dsw-alias-border-l1,#e3e4e8);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 16px 40px rgba(0,0,0,.16)}
.dph-diag .ttl{font-size:13px;font-weight:600;margin-bottom:8px}
.dph-diag-pre{margin:0 0 10px;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f4f4f5);font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary,#4b4b52);white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}
.dph-ghost{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#dededf);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6f6f76);font-size:12px;cursor:pointer}

.dph-headbtn{position:relative;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6f6f76);display:inline-grid;place-items:center;cursor:pointer;padding:0}
.dph-headbtn:hover{background:var(--dsw-alias-bg-layer-2,#f4f4f5);color:var(--dsw-alias-label-primary,#17171a)}
.dph-headbtn.active{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b6cff) 10%,transparent);color:var(--dsw-alias-brand-primary,#3b6cff)}
.dph-count{position:absolute;top:2px;right:2px;min-width:13px;height:13px;padding:0 3px;border-radius:7px;background:var(--dsw-alias-brand-primary,#3b6cff);color:#fff;font-size:9px;font-weight:600;display:grid;place-items:center}
`

    // ---------------------------------------------------------------- icons
    const SVG_PROPS = {
      width: 15,
      height: 15,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.9,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    }

    function Icon(props) {
      const name = props.name
      const size = props.size || 15
      const p = { ...SVG_PROPS, width: size, height: size, className: props.className }
      switch (name) {
        case 'phone':
          return h('svg', p, h('rect', { x: 6.5, y: 2.5, width: 11, height: 19, rx: 2.6 }), h('path', { d: 'M10.5 18.6h3' }))
        case 'cloud':
          return h('svg', p, h('path', { d: 'M7 18a4 4 0 0 1 .6-7.95A5.5 5.5 0 0 1 18.2 11 3.5 3.5 0 0 1 17.5 18Z' }))
        case 'refresh':
          return h('svg', p, h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6' }))
        case 'plus':
          return h('svg', p, h('path', { d: 'M12 5v14M5 12h14' }))
        case 'chevron':
          return h('svg', p, h('path', { d: 'm6 9 6 6 6-6' }))
        case 'back':
          return h('svg', p, h('path', { d: 'm15 18-6-6 6-6' }))
        case 'home':
          return h('svg', p, h('circle', { cx: 12, cy: 12, r: 7.5 }))
        case 'recents':
          return h('svg', p, h('rect', { x: 5.5, y: 5.5, width: 13, height: 13, rx: 2 }))
        case 'camera':
          return h(
            'svg',
            p,
            h('rect', { x: 3, y: 6, width: 18, height: 14, rx: 2.5 }),
            h('circle', { cx: 12, cy: 13, r: 3.4 }),
            h('path', { d: 'M8 6l1.4-2h5.2L16 6' }),
          )
        case 'more':
          return h(
            'svg',
            { ...p, fill: 'currentColor', stroke: 'none' },
            h('circle', { cx: 5, cy: 12, r: 1.5 }),
            h('circle', { cx: 12, cy: 12, r: 1.5 }),
            h('circle', { cx: 19, cy: 12, r: 1.5 }),
          )
        case 'power':
          return h('svg', p, h('path', { d: 'M12 3v9' }), h('path', { d: 'M6.4 6.4a8 8 0 1 0 11.2 0' }))
        case 'rotate':
          return h('svg', p, h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6' }))
        case 'link':
          return h(
            'svg',
            p,
            h('path', { d: 'M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1 1' }),
            h('path', { d: 'M14 11a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07l1-1' }),
          )
        case 'unlink':
          return h(
            'svg',
            p,
            h('path', { d: 'M15 7l2-2a5 5 0 0 1 7 7l-2 2' }),
            h('path', { d: 'M9 17l-2 2a5 5 0 0 1-7-7l2-2' }),
            h('path', { d: 'M4 4l16 16' }),
          )
        case 'info':
          return h(
            'svg',
            p,
            h('circle', { cx: 12, cy: 12, r: 8.5 }),
            h('path', { d: 'M12 11v5' }),
            h('path', { d: 'M12 8h.01' }),
          )
        case 'float':
          return h(
            'svg',
            p,
            h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }),
            h('rect', { x: 12, y: 11, width: 7, height: 6, rx: 1.2 }),
          )
        case 'right':
          return h('svg', p, h('path', { d: 'm9 6 6 6-6 6' }))
        case 'copy':
          return h(
            'svg',
            p,
            h('rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }),
            h('path', { d: 'M5 15V5a2 2 0 0 1 2-2h8' }),
          )
        case 'x':
          return h('svg', p, h('path', { d: 'm6 6 12 12M18 6 6 18' }))
        case 'check':
          return h('svg', p, h('path', { d: 'm5 13 4 4L19 7' }))
        default:
          return null
      }
    }

    const PhoneGlyph = (props) => h(Icon, { name: 'phone', size: (props && props.size) || 18 })

    // ---------------------------------------------------------------- api
    function createApi() {
      const unwrap = async (endpoint, payload) => {
        const res = await fetch('phone/' + endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
          credentials: 'same-origin',
        })
        const type = res.headers.get('content-type') || ''
        if (!type.includes('application/json')) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res
        }
        const body = await res.json()
        if (body && body.ok) return body.value
        const message = body && body.error && body.error.message ? body.error.message : 'rpc failed: ' + endpoint
        throw new Error(message)
      }
      return {
        health: () => unwrap('health'),
        devices: () => unwrap('devices'),
        connect: (address) => unwrap('connect', { address }),
        disconnect: (serial) => unwrap('disconnect', { serial }),
        input: (serial, event) => unwrap('input', { serial, event }),
        targets: () => unwrap('targets'),
        removeTarget: (address) => unwrap('targets/remove', { address }),
        shot: async (serial) => {
          const res = await unwrap('shot', { serial })
          return res.blob()
        },
      }
    }

    const api = createApi()

    // ---------------------------------------------------------------- hooks
    function useDeviceList(visible, nonce) {
      const [devices, setDevices] = useState(null)
      const [error, setError] = useState(null)
      const load = useCallback(async () => {
        try {
          const value = await api.devices()
          setDevices(Array.isArray(value.devices) ? value.devices : [])
          setError(null)
        } catch (err) {
          setError(err && err.message ? err.message : 'devices failed')
        }
      }, [])
      useEffect(() => {
        if (!visible) return undefined
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          await load()
          if (alive) timer = setTimeout(tick, 5000)
        }
        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [visible, load, nonce])
      return { devices, error, reload: load }
    }

    function kindForAddress(address) {
      if (/^unicom-openclaw-|\.ts\.net/.test(address)) return 'tailscale'
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) return 'tailscale'
      if (address.includes(':')) return 'wifi'
      return 'usb'
    }

    function kindLabel(kind) {
      if (kind === 'tailscale') return 'Tailscale'
      if (kind === 'wifi') return 'Wi-Fi'
      if (kind === 'emulator') return 'emulator'
      return 'USB'
    }

    function stateLabel(state, t) {
      if (state === 'device') return null
      if (state === 'saved') return t('saved')
      if (state === 'unauthorized') return t('unauthorized')
      if (state === 'offline') return t('offline')
      return state
    }

    // ---------------------------------------------------------------- components
    function DeviceRows(props) {
      const { t, devices, selected, onSelect, compact } = props
      const order = { usb: 0, emulator: 1, wifi: 2, tailscale: 3 }
      const sorted = [...devices].sort((a, b) => {
        const bySaved = (a.saved ? 1 : 0) - (b.saved ? 1 : 0)
        if (bySaved !== 0) return bySaved
        return (order[a.kind] ?? 9) - (order[b.kind] ?? 9)
      })
      return h(
        'div',
        { className: compact ? 'dph-menu-list' : 'dph-list' },
        sorted.map((device) =>
          h(
            'button',
            {
              key: device.serial,
              type: 'button',
              className: 'dph-row' + (device.serial === selected ? ' sel' : ''),
              onClick: () => onSelect(device),
            },
            h(
              'span',
              { className: 'dph-av' },
              h(Icon, { name: device.saved ? 'link' : device.kind === 'tailscale' ? 'cloud' : 'phone', size: 15 }),
              h('span', {
                className:
                  device.state === 'device' ? 'on' : device.state === 'unauthorized' ? 'on warn' : 'on off',
              }),
            ),
            h(
              'span',
              { className: 'dph-meta' },
              h(
                'span',
                { className: 'dph-model' },
                device.model,
                h('span', { className: 'dph-tag' }, kindLabel(device.kind)),
              ),
              device.serial && device.serial !== device.model
                ? h('span', { className: 'dph-serial' }, device.serial)
                : null,
            ),
            stateLabel(device.state, t)
              ? h('span', { className: 'dph-state' + (device.state === 'saved' ? ' saved' : '') }, stateLabel(device.state, t))
              : null,
            h(Icon, { name: 'right', size: 13, className: 'dph-chev' }),
          ),
        ),
      )
    }

    function HeaderButton(props) {
      const { t, open } = props
      const [count, setCount] = useState(null)
      useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          try {
            const value = await api.devices()
            const ready = (value.devices || []).filter((device) => device.state === 'device').length
            if (alive) setCount(ready)
          } catch {
            if (alive) setCount(null)
          }
          if (alive) timer = setTimeout(tick, 20000)
        }
        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [])
      return h(
        'button',
        {
          type: 'button',
          className: 'dph-headbtn',
          title: t('title'),
          'aria-label': t('title'),
          onClick: () => {
            try {
              open()
            } catch {}
          },
        },
        h(Icon, { name: 'phone', size: 16 }),
        count ? h('span', { className: 'dph-count' }, String(count)) : null,
      )
    }

    // ---------------------------------------------------------------- preview
    function usePreview(serial, visible) {
      const stageRef = useRef(null)
      const pointerRef = useRef(null)
      const urlRef = useRef(null)
      const [frameUrl, setFrameUrl] = useState(null)
      const [ratio, setRatio] = useState(1080 / 2400)
      const [size, setSize] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [attempt, setAttempt] = useState(0)
      const [toast, setToast] = useState(null)

      useEffect(() => {
        const el = stageRef.current
        if (!el) return undefined
        const measure = () => {
          const width = el.clientWidth
          const height = el.clientHeight
          if (!width || !height) return
          const availW = Math.max(60, width - 60)
          const availH = Math.max(120, height - 56)
          const screenW = Math.min(availW, availH * ratio)
          setSize({ w: Math.round(screenW), h: Math.round(screenW / ratio) })
        }
        measure()
        let observer = null
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(measure)
          observer.observe(el)
        }
        window.addEventListener('resize', measure)
        return () => {
          if (observer) observer.disconnect()
          window.removeEventListener('resize', measure)
        }
        // serial 变化时 stage 才挂载，effect 需要重跑一次才能量到尺寸
      }, [ratio, serial])

      useEffect(() => {
        if (!serial || !visible) return undefined
        let alive = true
        let timer = null
        setLoading(true)
        setError(null)
        const tick = async () => {
          if (!alive) return
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            timer = setTimeout(tick, 1200)
            return
          }
          try {
            const blob = await api.shot(serial)
            if (!alive) return
            const url = URL.createObjectURL(blob)
            if (urlRef.current) URL.revokeObjectURL(urlRef.current)
            urlRef.current = url
            setFrameUrl(url)
            setError(null)
            setLoading(false)
          } catch (err) {
            if (!alive) return
            setError(err && err.message ? err.message : 'shot failed')
            setLoading(false)
          }
          if (alive) timer = setTimeout(tick, 700)
        }
        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [serial, visible, attempt])

      useEffect(
        () => () => {
          if (urlRef.current) URL.revokeObjectURL(urlRef.current)
          urlRef.current = null
        },
        [],
      )

      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(null), 1600)
        return () => clearTimeout(timer)
      }, [toast])

      const send = useCallback(
        (event) => {
          api.input(serial, event).catch((err) => setToast(err && err.message ? err.message : 'input failed'))
        },
        [serial],
      )

      const onImageLoad = (event) => {
        const img = event.currentTarget
        if (img && img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight)
      }

      const pointOf = (img, clientX, clientY) => {
        const rect = img.getBoundingClientRect()
        const width = img.naturalWidth || 1080
        const height = img.naturalHeight || 2400
        return [
          Math.round(Math.min(width - 1, Math.max(0, ((clientX - rect.left) / rect.width) * width))),
          Math.round(Math.min(height - 1, Math.max(0, ((clientY - rect.top) / rect.height) * height))),
        ]
      }

      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return
        pointerRef.current = { t: Date.now(), x: event.clientX, y: event.clientY, img: event.currentTarget }
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {}
      }

      const onPointerUp = (event) => {
        const start = pointerRef.current
        pointerRef.current = null
        if (!start) return
        const img = start.img
        const dt = Date.now() - start.t
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (dt < 400 && distance < 8) {
          const point = pointOf(img, event.clientX, event.clientY)
          send({ action: 'tap', x: point[0], y: point[1] })
          return
        }
        const from = pointOf(img, start.x, start.y)
        const to = pointOf(img, event.clientX, event.clientY)
        send({ action: 'swipe', x1: from[0], y1: from[1], x2: to[0], y2: to[1], duration: Math.max(80, Math.min(1200, dt)) })
      }

      const screenshot = async () => {
        try {
          const blob = await api.shot(serial)
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = 'dsh-phone-' + String(serial).replace(/[^A-Za-z0-9._-]/g, '_') + '-' + Date.now() + '.png'
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => URL.revokeObjectURL(url), 3000)
          setToast('screenshot saved')
        } catch (err) {
          setToast(err && err.message ? err.message : 'shot failed')
        }
      }

      const retry = () => {
        setError(null)
        setLoading(true)
        setAttempt((value) => value + 1)
      }

      return {
        stageRef,
        size,
        ratio,
        frameUrl,
        error,
        loading,
        toast,
        setToast,
        send,
        screenshot,
        retry,
        onImageLoad,
        onPointerDown,
        onPointerUp,
      }
    }

    function PhoneTabBody(props) {
      const { t, useTabInfo, floatTab } = props
      const info = typeof useTabInfo === 'function' ? useTabInfo() : null
      const tab = info && info.tab ? info.tab : null
      const visible = tab ? tab.visible !== false : true

      const [selected, setSelected] = useState(null)
      const [menuOpen, setMenuOpen] = useState(false)
      const [moreOpen, setMoreOpen] = useState(false)
      const [connectOpen, setConnectOpen] = useState(false)
      const [address, setAddress] = useState('')
      const [connecting, setConnecting] = useState(false)
      const [connectError, setConnectError] = useState(null)
      const [nonce, setNonce] = useState(0)
      const [health, setHealth] = useState(null)
      const [targets, setTargets] = useState([])
      const [diagOpen, setDiagOpen] = useState(false)
      const { devices, error, reload } = useDeviceList(visible, nonce)
      const preview = usePreview(selected, visible && Boolean(selected))

      useEffect(() => {
        let alive = true
        api
          .health()
          .then((value) => {
            if (alive) setHealth(value)
          })
          .catch(() => {
            if (alive) setHealth({ adb: null, error: 'host unavailable' })
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        if (!visible) return undefined
        let alive = true
        api
          .targets()
          .then((value) => {
            if (alive) setTargets(Array.isArray(value.targets) ? value.targets : [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [visible, nonce])

      const savedRows = (targets || [])
        .filter((target) => !(devices || []).some((item) => item.serial === target.address))
        .map((target) => ({
          serial: target.address,
          state: 'saved',
          kind: kindForAddress(target.address),
          model: target.address,
          saved: true,
        }))
      const rows = devices === null ? null : devices.concat(savedRows)
      const device = rows ? rows.find((item) => item.serial === selected) || null : null
      const tabId = tab && tab.id ? tab.id : null
      const adbMissing = health && health.adb === null

      const connectTo = async (address) => {
        setConnecting(true)
        setConnectError(null)
        try {
          await api.connect(address)
          setConnectOpen(false)
          setAddress('')
          setNonce((value) => value + 1)
          return true
        } catch (err) {
          setConnectError(err && err.message ? err.message : 'connect failed')
          return false
        } finally {
          setConnecting(false)
        }
      }

      const onSelect = (picked) => {
        setMenuOpen(false)
        if (picked && picked.saved) {
          connectTo(picked.serial).then((ok) => {
            if (ok) setSelected(picked.serial)
          })
          return
        }
        setSelected(picked.serial)
      }

      const removeTarget = async (target) => {
        try {
          await api.removeTarget(target.address)
          setTargets((list) => list.filter((item) => item.address !== target.address))
        } catch (err) {
          preview.setToast(err && err.message ? err.message : 'remove failed')
        }
      }

      const onConnect = async (event) => {
        if (event) event.preventDefault()
        if (!address.trim() || connecting) return
        await connectTo(address.trim())
      }

      const copySerial = async () => {
        try {
          await navigator.clipboard.writeText(selected)
          preview.setToast(t('copied'))
        } catch {
          preview.setToast(selected)
        }
      }

      const moreItems = [
        { id: 'power', icon: 'power', label: t('power'), run: () => preview.send({ action: 'key', key: 'power' }) },
        { id: 'rotate', icon: 'rotate', label: t('rotate'), run: () => preview.send({ action: 'rotate' }) },
        {
          id: 'reconnect',
          icon: 'link',
          label: t('reconnect'),
          run: () => {
            if (!selected || !selected.includes(':')) {
              preview.setToast(t('reconnect'))
              return
            }
            api
              .connect(selected)
              .then(() => preview.setToast(t('reconnect')))
              .catch((err) => preview.setToast(err && err.message ? err.message : 'reconnect failed'))
          },
        },
        {
          id: 'diag',
          icon: 'info',
          label: t('diagnostics'),
          run: () => setDiagOpen(true),
        },
        {
          id: 'float',
          icon: 'float',
          label: t('float'),
          run: () => {
            if (!tabId || typeof floatTab !== 'function') {
              preview.setToast(t('float'))
              return
            }
            const ratio = preview.ratio || 1080 / 2400
            const height = Math.max(420, Math.min(760, window.innerHeight - 120))
            const width = Math.round((height - 100) * ratio + 64)
            floatTab(tabId, {
              x: Math.max(8, window.innerWidth - width - 24),
              y: 72,
              width,
              height,
            })
          },
        },
        { id: 'copy', icon: 'copy', label: t('copySerial'), run: copySerial },
        {
          id: 'list',
          icon: 'back',
          label: t('devices'),
          run: () => setSelected(null),
        },
        {
          id: 'disconnect',
          icon: 'unlink',
          label: t('disconnect'),
          run: () => {
            api
              .disconnect(selected)
              .catch(() => {})
              .then(() => setSelected(null))
          },
        },
      ]

      const menu = menuOpen
        ? h(
            'div',
            null,
            h('div', { className: 'dph-backdrop', onClick: () => setMenuOpen(false) }),
            h(
              'div',
              { className: 'dph-menu' },
              selected
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dph-row',
                      onClick: () => {
                        setMenuOpen(false)
                        setSelected(null)
                      },
                    },
                    h('span', { className: 'dph-av', style: { width: 26, height: 26, borderRadius: 7 } }, h(Icon, { name: 'back', size: 14 })),
                    h('span', { className: 'dph-meta' }, h('span', { className: 'dph-model', style: { fontWeight: 400 } }, t('devices'))),
                  )
                : null,
              devices && devices.length
                ? h(DeviceRows, { t, devices, selected, onSelect, compact: true })
                : h('div', { className: 'dph-emptypadding' }, t('empty')),
              h(
                'div',
                { className: 'dph-menu-foot' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dph-link',
                    onClick: () => {
                      setMenuOpen(false)
                      setConnectOpen(true)
                    },
                  },
                  '+ ' + t('add'),
                ),
              ),
            ),
          )
        : null

      const connectSheet = connectOpen
        ? h(
            'div',
            null,
            h('div', {
              className: 'dph-backdrop',
              onClick: () => {
                setConnectOpen(false)
                setConnectError(null)
              },
            }),
            h(
              'form',
              { className: 'dph-connect', onSubmit: onConnect },
              h('div', { className: 'ttl' }, t('add')),
              h('div', { className: 'sub' }, 'adb connect <ip>:<port>'),
              h(
                'div',
                { className: 'dph-field' },
                h('input', {
                  className: 'dph-input',
                  value: address,
                  placeholder: '100.90.248.53:5555',
                  onChange: (event) => setAddress(event.target.value),
                  autoFocus: true,
                  spellCheck: false,
                }),
                h('button', { type: 'submit', className: 'dph-primary', disabled: connecting || !address.trim() }, connecting ? t('connecting') : t('connect')),
              ),
              connectError ? h('div', { className: 'dph-err' }, connectError) : null,
              h(
                'div',
                { className: 'dph-saved' },
                h('div', { className: 'dph-saved-title' }, t('saved')),
                targets.length === 0
                  ? h('div', { className: 'dph-saved-empty' }, t('noSaved'))
                  : targets.map((target) =>
                      h(
                        'div',
                        { className: 'dph-saved-row', key: target.address },
                        h('span', { className: 'dph-saved-addr' }, target.address),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dph-link',
                            onClick: () => connectTo(target.address),
                          },
                          t('connect'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dph-link dph-link-muted',
                            title: t('remove'),
                            onClick: () => removeTarget(target),
                          },
                          '×',
                        ),
                      ),
                    ),
              ),
            ),
          )
        : null

      const diagText = [
        'adb: ' + (health && health.adb ? (health.adb.version || '?') + ' @ ' + (health.adb.bin || '?') : t('noAdb')),
        'devices: ' + (devices ? devices.length : '?'),
      ]
        .concat((devices || []).map((item) => item.serial + '  ' + item.state + '  ' + item.model))
        .join('\n')

      const diagSheet = diagOpen
        ? h(
            'div',
            null,
            h('div', { className: 'dph-backdrop', onClick: () => setDiagOpen(false) }),
            h(
              'div',
              { className: 'dph-diag' },
              h('div', { className: 'ttl' }, t('diagnostics')),
              h('pre', { className: 'dph-diag-pre' }, diagText),
              h('div', { className: 'dph-saved-empty' }, t('diagHint')),
              h(
                'div',
                { className: 'dph-field' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dph-primary',
                    onClick: async () => {
                      try {
                        await navigator.clipboard.writeText(diagText)
                        preview.setToast(t('copied'))
                      } catch {
                        preview.setToast(t('copyDiag'))
                      }
                    },
                  },
                  t('copyDiag'),
                ),
                h('button', { type: 'button', className: 'dph-ghost', onClick: () => setDiagOpen(false) }, t('cancel')),
              ),
            ),
          )
        : null

      const moreMenu = moreOpen
        ? h(
            'div',
            null,
            h('div', { className: 'dph-backdrop', onClick: () => setMoreOpen(false) }),
            h(
              'div',
              { className: 'dph-menu', style: { top: 40, left: 'auto', right: 8, width: 220 } },
              moreItems.map((item) =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    className: 'dph-row',
                    onClick: () => {
                      setMoreOpen(false)
                      item.run()
                    },
                  },
                  h('span', { className: 'dph-av', style: { width: 26, height: 26, borderRadius: 7 } }, h(Icon, { name: item.icon, size: 14 })),
                  h('span', { className: 'dph-meta' }, h('span', { className: 'dph-model', style: { fontWeight: 400 } }, item.label)),
                ),
              ),
            ),
          )
        : null

      const stage = h(
        'div',
        { className: 'dph-stage', ref: preview.stageRef },
        h(
          'div',
          {
            className: 'dph-phone',
            style: preview.size ? { width: preview.size.w + 18, height: preview.size.h + 18 } : { width: 252, height: 548 },
          },
          h(
            'div',
            { className: 'dph-screen' },
            preview.frameUrl
              ? h('img', {
                  src: preview.frameUrl,
                  alt: selected || 'device',
                  draggable: false,
                  onLoad: preview.onImageLoad,
                  onPointerDown: preview.onPointerDown,
                  onPointerUp: preview.onPointerUp,
                })
              : null,
            preview.loading && !preview.frameUrl
              ? h('div', { className: 'dph-overlay' }, h('div', { className: 'dph-spin' }), h('div', { className: 'msg' }, t('loading')))
              : null,
            preview.error
              ? h(
                  'div',
                  { className: 'dph-overlay' },
                  h('div', { className: 'msg' }, preview.error),
                  h('button', { type: 'button', className: 'dph-btn', onClick: preview.retry }, t('retry')),
                )
              : null,
          ),
        ),
      )

      const listBody = adbMissing
        ? h(
            'div',
            { className: 'dph-emptypadding' },
            h('div', null, t('noAdb')),
            h('button', { type: 'button', className: 'dph-link', style: { marginTop: 8 }, onClick: () => setNonce((value) => value + 1) }, t('retry')),
          )
        : error
          ? h(
              'div',
              { className: 'dph-emptypadding' },
              h('div', null, error.indexOf('404') >= 0 ? t('waitingHost') : error),
              h('button', { type: 'button', className: 'dph-link', style: { marginTop: 8 }, onClick: () => setNonce((value) => value + 1) }, t('retry')),
            )
          : rows === null
            ? h('div', { className: 'dph-emptypadding' }, t('loading'))
            : rows.length === 0
              ? h(
                  'div',
                  { className: 'dph-emptypadding' },
                  h('div', null, t('empty')),
                  h('button', { type: 'button', className: 'dph-link', style: { marginTop: 8 }, onClick: () => setConnectOpen(true) }, '+ ' + t('add')),
                )
              : h(DeviceRows, { t, devices: rows, selected, onSelect })

      const rightButtons = selected
        ? [
            h(
              'button',
              { key: 'back', type: 'button', className: 'dph-ibtn', title: t('back'), onClick: () => preview.send({ action: 'key', key: 'back' }) },
              h(Icon, { name: 'back' }),
            ),
            h(
              'button',
              { key: 'home', type: 'button', className: 'dph-ibtn', title: t('home'), onClick: () => preview.send({ action: 'key', key: 'home' }) },
              h(Icon, { name: 'home' }),
            ),
            h(
              'button',
              { key: 'recents', type: 'button', className: 'dph-ibtn', title: t('recents'), onClick: () => preview.send({ action: 'key', key: 'recents' }) },
              h(Icon, { name: 'recents' }),
            ),
            h('button', { key: 'shot', type: 'button', className: 'dph-ibtn', title: t('screenshot'), onClick: preview.screenshot }, h(Icon, { name: 'camera' })),
            h(
              'button',
              { key: 'more', type: 'button', className: 'dph-ibtn', title: t('more'), onClick: () => setMoreOpen((value) => !value) },
              h(Icon, { name: 'more' }),
            ),
          ]
        : [
            h(
              'button',
              { key: 'refresh', type: 'button', className: 'dph-ibtn', title: t('refresh'), onClick: () => setNonce((value) => value + 1) },
              h(Icon, { name: 'refresh' }),
            ),
            h(
              'button',
              { key: 'add', type: 'button', className: 'dph-ibtn', title: t('add'), onClick: () => setConnectOpen(true) },
              h(Icon, { name: 'plus' }),
            ),
          ]

      return h(
        'div',
        { className: 'dph-root' },
        h(
          'div',
          { className: 'dph-bar' },
          h(
            'button',
            { type: 'button', className: 'dph-select', onClick: () => setMenuOpen(true), title: t('select') },
            h(Icon, { name: 'phone', size: 14 }),
            h('span', { className: 'nm' }, device ? device.model : t('select')),
            h(Icon, { name: 'chevron', size: 12, className: 'chev' }),
          ),
          h('div', { className: 'dph-grow' }),
          rightButtons,
        ),
        selected ? stage : listBody,
        preview.toast ? h('div', { className: 'dph-toast' }, preview.toast) : null,
        menu,
        moreMenu,
        connectSheet,
        diagSheet,
      )
    }

    // ---------------------------------------------------------------- apply
    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-phone: locale')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.id = 'dsh-phone-style'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'dsh-phone: styles')

        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'dsh-phone',
              order: 10,
              locale: NS,
              inject: () => ({
                open: () => ctx.sidebarRight.openTab('phone'),
              }),
            },
            HeaderButton,
          ),
        )

        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: 'dsh-phone',
              kind: 'phone',
              multiple: false,
              priority: 'builtin',
              title: () => (ctx.locale.bind ? ctx.locale.bind(NS)('title') : '手机'),
              guide: [
                {
                  id: 'open',
                  order: 30,
                  title: () => (ctx.locale.bind ? ctx.locale.bind(NS)('title') : '手机'),
                  description: () => (ctx.locale.bind ? ctx.locale.bind(NS)('desc') : ''),
                  icon: PhoneGlyph,
                },
              ],
            }),
          'dsh-phone: tab type',
        )

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: 'dsh-phone',
              locale: NS,
              inject: () => ({
                floatTab: (tabId, rect) => ctx.sidebarRight.float(tabId, rect),
              }),
            },
            PhoneTabBody,
          ),
        )
      },
    }
  },
})
