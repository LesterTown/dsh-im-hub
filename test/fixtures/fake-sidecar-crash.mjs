// 模拟一个会崩溃的 sidecar：启动 300ms 后自行退出（模拟 WeChatFerry 崩溃）。
// 仅供测试 WeChatAdapter 的自动重启逻辑。
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin })

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

rl.on('line', (line) => {
  line = line.trim()
  if (!line) return
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  const { id, cmd } = req
  switch (cmd) {
    case 'get_qrcode': return send({ id, ok: true, result: '' })
    case 'is_login': return send({ id, ok: true, result: true })
    case 'send_text': return send({ id, ok: true, result: 0 })
    case 'get_friends': return send({ id, ok: true, result: [] })
    case 'shutdown':
      send({ id, ok: true, result: true })
      process.exit(0)
      return
    default:
      return send({ id, ok: false, error: `unknown ${cmd}` })
  }
})

setTimeout(() => process.exit(1), 300)
