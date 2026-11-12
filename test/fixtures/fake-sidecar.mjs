// 模拟 WeChatFerry sidecar：读 stdin JSON-Lines，回响应，启动后推一条私聊消息。
// 仅供测试 WeChatAdapter 的 stdio 桥协议，不依赖真实 WeChatFerry。
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin })

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

setTimeout(() => {
  send({
    type: 'message',
    msg: { id: 1, type: 1, is_group: false, roomid: '', sender: 'wxid_test', content: 'hello', ts: 1700000000 },
  })
}, 50)

rl.on('line', (line) => {
  line = line.trim()
  if (!line) return
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  const { id, cmd, args } = req
  switch (cmd) {
    case 'get_qrcode': return send({ id, ok: true, result: '' })
    case 'is_login': return send({ id, ok: true, result: true })
    case 'send_text': return send({ id, ok: true, result: 0 })
    case 'get_friends': return send({ id, ok: true, result: [{ wxid: 'wxid_test', name: '测试' }] })
    case 'shutdown':
      send({ id, ok: true, result: true })
      process.exit(0)
      return
    default:
      return send({ id, ok: false, error: `unknown ${cmd}` })
  }
})
