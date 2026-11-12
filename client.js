// client.js — 设置面板（settings.section 槽位）：总开关 + 人设 + 模型 + 各平台开关
// 参照 dsh-cursor-dev / dsh-bili-watch 的 ModuleLoader + slots 模式；无 JSX 无 bundler。
window.__ModuleLoader__.load({
  id: 'dsh-im-hub',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    const CARD = { padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '12px' }
    const ROW = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }
    const FIELD = { display: 'flex', flexDirection: 'column', gap: '4px' }
    const LABEL = { fontSize: '12px', opacity: 0.7 }
    const INPUT = { padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' }
    const BTN = { padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(127,127,127,0.4)', background: 'transparent', color: 'inherit', cursor: 'pointer' }
    const ON = { background: 'rgba(66,133,244,0.9)', color: '#fff', borderColor: 'transparent' }
    const ERR = { color: '#e74c3c', fontSize: '12px' }

    function safe(s) {
      return s && typeof s.getSnapshot === 'function' ? s.getSnapshot() : s
    }

    function Toggle({ value, onChange, label, disabled }) {
      return h('div', { style: ROW },
        h('span', null, label),
        h('button', { style: Object.assign({}, BTN, value ? ON : {}), onClick: () => onChange(!value), disabled },
          value ? '开启' : '关闭'))
    }

    function TextField({ value, onChange, label, placeholder, rows }) {
      const props = { style: INPUT, value: value || '', placeholder, onChange: (e) => onChange(e.target.value) }
      return h('div', { style: FIELD },
        h('span', { style: LABEL }, label),
        rows ? h('textarea', Object.assign({}, props, { rows })) : h('input', props))
    }

    function Panel({ form }) {
      const [snap, setSnap] = useState(() => safe(form))
      const [err, setErr] = useState('')
      useEffect(() => {
        if (!form) return
        return form.subscribe((s) => { setSnap(safe(s)); setErr('') })
      }, [form])
      const status = snap && snap.status
      const v = (snap && snap.value) || {}
      const notReady = status !== 'ready'

      const write = (field, value) => {
        if (!form) return
        setErr('')
        Promise.resolve(form.set(field, value)).then((ok) => {
          if (!ok) setErr(`保存 ${field} 失败（宿主拒绝）`)
        }).catch((e) => setErr(String(e && e.message || e)))
      }

      if (notReady) {
        return h('div', { style: CARD },
          h('div', { style: ERR }, `配置未就绪（${status || 'unknown'}）。如刚改过插件，请完全退出重开 DeepSeek Harness。`))
      }

      return h('div', { style: CARD },
        h(Toggle, { value: !!v.enabled, onChange: (x) => write('enabled', x), label: '总开关：启用跨 IM 自动回复' }),
        h(TextField, { value: v.persona, onChange: (x) => write('persona', x), label: '人设（system prompt）', placeholder: '例如：你是一个随和的朋友…', rows: 3 }),
        h(TextField, { value: v.model, onChange: (x) => write('model', x), label: '模型', placeholder: 'deepseek-v4-pro' }),
        h(Toggle, { value: !!v.qqEnabled, onChange: (x) => write('qqEnabled', x), label: 'QQ（NapCat / OneBot）' }),
        v.qqEnabled ? h(TextField, { value: v.qqWsUrl, onChange: (x) => write('qqWsUrl', x), label: 'QQ WebSocket 地址', placeholder: 'ws://127.0.0.1:3001' }) : null,
        v.qqEnabled ? h(TextField, { value: v.qqToken, onChange: (x) => write('qqToken', x), label: 'QQ accessToken' }) : null,
        h(Toggle, { value: !!v.wxEnabled, onChange: (x) => write('wxEnabled', x), label: '微信（WeChatFerry）' }),
        err ? h('div', { style: ERR }, err) : null)
    }

    function apply(ctx) {
      ctx.inject(['configForms', 'slots'], (injected) => {
        const forms = injected.get('configForms')
        const slots = injected.get('slots')
        const form = forms.get('dsh-im-hub')
        slots.inject('settings.section', () => slots.register({
          name: 'settings.section',
          id: 'dsh-im-hub',
          order: 50,
          label: () => '跨 IM 自动回复',
        }, () => h(Panel, { form })))
      })
    }

    return { name: 'dsh-im-hub-client', apply, inject: [] }
  },
})
