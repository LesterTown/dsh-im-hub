import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { QQAdapter } from '../lib/adapters/qq.js'
import { WeChatAdapter } from '../lib/adapters/wechat.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, 'fixtures', 'fake-sidecar.mjs')
const CRASH_FIXTURE = join(__dirname, 'fixtures', 'fake-sidecar-crash.mjs')
const silent = { info: () => {}, warn: () => {}, error: () => {} }

async function waitFor(cond, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

test('QQAdapter 私聊事件分发 + sendPrivate 发送正确 action', async () => {
  let sentRaw = null
  const fakeWs = {
    readyState: 1,
    addEventListener: () => {},
    send: (d) => { sentRaw = d },
    close: () => {},
  }
  const events = []
  const qa = new QQAdapter({ wsUrl: 'ws://127.0.0.1:1', token: '', onEvent: (e) => events.push(e), logger: silent })
  qa.ws = fakeWs

  qa._onMessage(JSON.stringify({
    post_type: 'message', message_type: 'private',
    user_id: 123, message_id: 7,
    message: [{ type: 'text', data: { text: '哈咯' } }],
  }))
  assert.equal(events.length, 1)
  assert.equal(events[0].platform, 'qq')
  assert.equal(events[0].contactId, '123')
  assert.equal(events[0].text, '哈咯')

  const p = qa.sendPrivate(123, '回复')
  const sent = JSON.parse(sentRaw)
  assert.equal(sent.action, 'send_private_msg')
  assert.equal(sent.params.user_id, 123)
  assert.equal(sent.params.message, '回复')
  qa._onMessage(JSON.stringify({ echo: sent.echo, status: 'ok', retcode: 0 }))
  await p

  qa.stop()
})

test('QQAdapter 群聊事件归一化 + 忽略 meta_event', () => {
  const events = []
  const qa = new QQAdapter({ wsUrl: 'ws://127.0.0.1:1', token: '', onEvent: (e) => events.push(e), logger: silent })
  qa.ws = { readyState: 1, addEventListener: () => {}, send: () => {}, close: () => {} }

  qa._onMessage(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat' }))
  assert.equal(events.length, 0)

  qa._onMessage(JSON.stringify({
    post_type: 'message', message_type: 'group',
    group_id: 888, user_id: 1,
    message: [{ type: 'text', data: { text: '群消息' } }],
  }))
  assert.equal(events.length, 1)
  assert.equal(events[0].isGroup, true)
  assert.equal(events[0].unifiedId, 'qq:group:888')
  assert.equal(events[0].text, '群消息')
})

test('WeChatAdapter stdio 桥：call 往返 + 消息分发', async () => {
  const events = []
  const adapter = new WeChatAdapter({
    sidecarPath: FIXTURE,
    python: process.execPath, // 用 node 跑 fake sidecar
    onEvent: (e) => events.push(e),
    onQr: () => {},
    logger: silent,
  })
  await adapter.start()
  await new Promise((r) => setTimeout(r, 200))

  assert.equal(events.length, 1)
  assert.equal(events[0].platform, 'wechat')
  assert.equal(events[0].contactId, 'wxid_test')
  assert.equal(events[0].text, 'hello')

  assert.equal(await adapter.sendText('wxid_test', 'hi'), true)
  assert.deepEqual(await adapter.getFriends(), [{ wxid: 'wxid_test', name: '测试' }])

  adapter.stop()
  await new Promise((r) => setTimeout(r, 100))
})

test('WeChatAdapter sidecar 崩溃后自动重启，stop 后不再重启', async () => {
  const adapter = new WeChatAdapter({
    sidecarPath: CRASH_FIXTURE,
    python: process.execPath,
    onEvent: () => {},
    onQr: () => {},
    logger: silent,
    restartDelayMs: 100,
  })
  await adapter.start()
  // 第一次启动，拿到 pid
  assert.ok(await waitFor(() => adapter.proc !== null, 2000))
  const pid1 = adapter.proc.pid
  // sidecar 崩溃（300ms）后应自动重启出一个新进程
  assert.ok(await waitFor(() => adapter.proc !== null && adapter.proc.pid !== pid1, 3000))

  // stop 后不再重启
  adapter.stop()
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(adapter.proc, null)
  assert.equal(adapter.restartTimer, null)
})
