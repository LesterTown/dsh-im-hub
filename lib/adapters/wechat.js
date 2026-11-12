// adapters/wechat.js — 微信适配器：spawn Python sidecar（WeChatFerry），JSON-Lines over stdio
import { spawn } from 'node:child_process'
import { fromWeChat } from '../normalize.js'

export class WeChatAdapter {
  constructor({ sidecarPath, python = 'python', onEvent, onQr, logger, restartDelayMs = 3000 }) {
    this.sidecarPath = sidecarPath
    this.python = python
    this.onEvent = onEvent || (() => {})
    this.onQr = onQr || (() => {})
    this.logger = logger || console
    this.proc = null
    this.buffer = ''
    this.reqId = 0
    this.pending = new Map()
    this.stopped = false
    this.restartDelayMs = restartDelayMs
    this.restartDelay = restartDelayMs
    this.restartTimer = null
  }

  async start() {
    if (this.stopped || this.proc) return // 防重复 spawn
    const proc = spawn(this.python, [this.sidecarPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    proc.stdout.on('data', (chunk) => this._onData(chunk.toString()))
    proc.stderr.on('data', (chunk) => this.logger.warn(`[dsh-im-hub][wx] stderr: ${chunk.toString().trim()}`))
    proc.on('error', (e) => {
      // spawn 失败（如 python 不存在）：'error' 触发但 'exit' 不一定触发
      this.logger.warn(`[dsh-im-hub][wx] sidecar 启动失败: ${e && e.message}`)
      this.pending.forEach((p) => p.reject(new Error(`sidecar 启动失败: ${e && e.message}`)))
      this.pending.clear()
      this.proc = null
      this._scheduleRestart()
    })
    proc.on('exit', (code) => {
      this.logger.warn(`[dsh-im-hub][wx] sidecar 退出 code=${code}`)
      this.pending.forEach((p) => p.reject(new Error(`sidecar 退出 code=${code}`)))
      this.pending.clear()
      this.proc = null
      this._scheduleRestart()
    })

    // 启动后拿二维码（未登录时返回图片，已登录返回空）
    try {
      const qr = await this.call('get_qrcode')
      if (qr) this.onQr(qr)
      const login = await this.call('is_login')
      this.logger.info(`[dsh-im-hub][wx] 微信登录状态: ${login === true ? '已登录' : '未登录'}`)
      this.restartDelay = this.restartDelayMs // 成功启动后重置退避
    } catch (e) {
      this.logger.warn(`[dsh-im-hub][wx] 初始化探测失败: ${e.message}`)
    }
  }

  _scheduleRestart() {
    if (this.stopped || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start().catch((e) => this.logger.warn(`[dsh-im-hub][wx] 重启失败: ${e && e.message}`))
    }, this.restartDelay)
    this.restartDelay = Math.min(this.restartDelay * 2, 30000) // 指数退避，封顶 30s
  }

  _onData(chunk) {
    this.buffer += chunk
    let idx
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      this._dispatch(obj)
    }
  }

  _dispatch(obj) {
    if (obj.type === 'message') {
      this.onEvent(fromWeChat(obj.msg))
      return
    }
    if (obj.id !== undefined && this.pending.has(obj.id)) {
      const { resolve, reject } = this.pending.get(obj.id)
      this.pending.delete(obj.id)
      if (obj.ok) resolve(obj.result)
      else reject(new Error(obj.error || 'sidecar 返回失败'))
    }
  }

  call(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.exitCode !== null) {
        reject(new Error('微信 sidecar 未运行'))
        return
      }
      const id = String(++this.reqId)
      this.pending.set(id, { resolve, reject })
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`微信 ${cmd} 超时`))
        }
      }, 10000)
    })
  }

  async sendText(receiver, text) {
    const r = await this.call('send_text', { text, receiver })
    return r === 0
  }

  async getFriends() {
    return this.call('get_friends')
  }

  stop() {
    this.stopped = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    try {
      if (this.proc && this.proc.exitCode === null) {
        this.proc.stdin.write(JSON.stringify({ id: '0', cmd: 'shutdown', args: {} }) + '\n')
        const p = this.proc
        setTimeout(() => { try { p.kill() } catch {} }, 1500)
      }
    } catch {}
  }
}
