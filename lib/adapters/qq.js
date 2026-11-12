// adapters/qq.js — OneBot v11 正向 WebSocket 客户端（NapCat）
// 依赖 Node >=22 的全局 WebSocket；不引 pynng/protobuf。
import { fromOneBotPrivate, fromOneBotGroup } from '../normalize.js'

export class QQAdapter {
  constructor({ wsUrl, token, selfId = '', onEvent, logger, reconnectDelayMs = 2000 }) {
    this.wsUrl = wsUrl
    this.token = token
    this.selfId = selfId
    this.onEvent = onEvent || (() => {})
    this.logger = logger || console
    this.ws = null
    this.closed = false
    this.echo = 0
    this.pending = new Map() // echo -> resolver
    this.reconnectDelayMs = reconnectDelayMs
    this.reconnectDelay = reconnectDelayMs
  }

  async start() {
    const url = new URL(this.wsUrl)
    if (this.token && !url.searchParams.has('access_token')) {
      url.searchParams.set('access_token', this.token)
    }
    const ws = new WebSocket(url.toString())
    this.ws = ws
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return // 旧连接的迟到事件
      this.reconnectDelay = this.reconnectDelayMs
      this.logger.info(`[dsh-im-hub][qq] 已连接 OneBot: ${this.wsUrl}`)
    })
    ws.addEventListener('message', (ev) => {
      if (this.ws === ws) this._onMessage(ev.data)
    })
    ws.addEventListener('error', (e) => {
      if (this.ws === ws) this.logger.warn(`[dsh-im-hub][qq] ws error`, e && e.message)
    })
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return // 忽略旧连接
      this.logger.warn(`[dsh-im-hub][qq] ws 已断开`)
      if (!this.closed) this._scheduleReconnect()
    })
  }

  _scheduleReconnect() {
    setTimeout(() => {
      if (!this.closed) this.start().catch((e) => this.logger.warn(`[dsh-im-hub][qq] 重连失败`, e))
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
  }

  _onMessage(raw) {
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      return
    }
    // 响应回包（echo 键统一按字符串匹配，兼容服务端回数字/字符串）
    if (data.echo !== undefined && this.pending.has(String(data.echo))) {
      const { resolve } = this.pending.get(String(data.echo))
      this.pending.delete(String(data.echo))
      resolve(data)
      return
    }
    // 事件推送
    if (data.post_type !== 'message') return
    if (data.message_type === 'private') {
      this.onEvent(fromOneBotPrivate(data, this.selfId))
    } else if (data.message_type === 'group') {
      this.onEvent(fromOneBotGroup(data))
    }
  }

  _send(action, params) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) {
        reject(new Error('QQ ws 未连接'))
        return
      }
      const echo = String(++this.echo)
      this.pending.set(echo, { resolve })
      this.ws.send(JSON.stringify({ action, params, echo }))
      setTimeout(() => {
        if (this.pending.has(echo)) {
          this.pending.delete(echo)
          reject(new Error(`QQ ${action} 超时`))
        }
      }, 8000)
    })
  }

  async sendPrivate(userId, text) {
    await this._send('send_private_msg', { user_id: Number(userId), message: text })
  }

  async sendGroup(groupId, text) {
    await this._send('send_group_msg', { group_id: Number(groupId), message: text })
  }

  stop() {
    this.closed = true
    try {
      this.ws && this.ws.close()
    } catch {}
  }
}
