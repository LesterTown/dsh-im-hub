import test from 'node:test'
import assert from 'node:assert/strict'
import { createReplyHandler } from '../lib/pipeline.js'

function makeHandler(overrides = {}) {
  const state = {}
  const calls = { send: [], stream: [], saveMemory: [], saveSession: [], saveState: [] }
  const mem = {}
  const ses = {}
  const deps = {
    getCfg: () => ({ persona: '你是助手', provider: 'p', model: 'm', replyCooldownSec: 0, maxHistoryTurns: 20 }),
    state,
    loadMemory: (id) => mem[id] ?? '',
    saveMemory: (id, t) => { mem[id] = t; calls.saveMemory.push([id, t]) },
    loadSession: (id) => ses[id] ?? [],
    saveSession: (id, t) => { ses[id] = t; calls.saveSession.push([id, t]) },
    saveState: (s) => calls.saveState.push(s),
    buildMessages: ({ persona, memoryText, history, incoming }) => [{ role: 'user', content: [{ type: 'text', text: `${persona}|${memoryText}|${incoming}` }] }],
    streamText: async (ctx, { provider, model, messages }) => { calls.stream.push({ provider, model, messages }); return '回复内容' },
    consolidateMemory: (m, u, a) => `${m}${u}->${a}\n`,
    send: async (platform, contactId, reply) => { calls.send.push([platform, contactId, reply]) },
    ctx: {},
    logger: { info() {}, warn() {} },
    ...overrides,
  }
  return { handler: createReplyHandler(deps), state, calls, mem, ses, deps }
}

function textEvt(overrides = {}) {
  return {
    platform: 'qq', contactId: '123', unifiedId: 'qq:123', isGroup: false,
    kind: 'text', text: '你好', ts: 1000, raw: { message_id: 7 },
    ...overrides,
  }
}

test('文本私聊：LLM 被调 + 回发正确平台 + 状态/会话/记忆都落盘', async () => {
  const { handler, calls, mem, ses, state } = makeHandler()
  const r = await handler(textEvt())

  assert.deepEqual(r, { handled: true, reply: '回复内容' })
  assert.equal(calls.stream.length, 1)
  assert.equal(calls.stream[0].provider, 'p')
  assert.equal(calls.stream[0].model, 'm')
  assert.match(calls.stream[0].messages[0].content[0].text, /你好/)
  assert.deepEqual(calls.send, [['qq', '123', '回复内容']])
  assert.equal(state['qq:123'].lastInboundId, '7')
  assert.equal(state['qq:123'].lastSentText, '回复内容')
  assert.equal(calls.saveState.length, 1)
  assert.equal(calls.saveSession.length, 1)
  assert.equal(calls.saveMemory.length, 1)
  assert.match(mem['qq:123'], /你好->回复内容/)
  assert.deepEqual(ses['qq:123'], [{ user: '你好', assistant: '回复内容' }])
})

test('群聊事件跳过', async () => {
  const { handler, calls } = makeHandler()
  const r = await handler(textEvt({ isGroup: true, unifiedId: 'qq:group:888' }))
  assert.deepEqual(r, { handled: false, reason: 'group' })
  assert.equal(calls.stream.length, 0)
  assert.equal(calls.send.length, 0)
})

test('非文本（图片）跳过', async () => {
  const { handler, calls } = makeHandler()
  const r = await handler(textEvt({ kind: 'image', text: '' }))
  assert.deepEqual(r, { handled: false, reason: 'non-text' })
  assert.equal(calls.stream.length, 0)
})

test('空文本跳过', async () => {
  const { handler, calls } = makeHandler()
  const r = await handler(textEvt({ text: '' }))
  assert.deepEqual(r, { handled: false, reason: 'non-text' })
})

test('同一 inbound id 去重：第二次不回复', async () => {
  const { handler, calls } = makeHandler()
  await handler(textEvt({ raw: { message_id: 7 }, text: '第一次' }))
  const r = await handler(textEvt({ raw: { message_id: 7 }, text: '重复' }))
  assert.deepEqual(r, { handled: false, reason: 'dup' })
  assert.equal(calls.stream.length, 1) // 只调了一次 LLM
  assert.equal(calls.send.length, 1)
})

test('冷却期内第二条消息跳过', async () => {
  const { handler, calls } = makeHandler({ getCfg: () => ({ persona: '', provider: 'p', model: 'm', replyCooldownSec: 10, maxHistoryTurns: 20 }) })
  await handler(textEvt({ raw: { message_id: 1 }, text: 'a' }))
  const r = await handler(textEvt({ raw: { message_id: 2 }, text: 'b' }))
  assert.deepEqual(r, { handled: false, reason: 'cooldown' })
  assert.equal(calls.send.length, 1)
})

test('LLM 抛错：不发送、不落盘为已回复', async () => {
  const { handler, calls, state } = makeHandler({
    streamText: async () => { throw new Error('RATE_LIMIT') },
  })
  const r = await handler(textEvt())
  assert.deepEqual(r, { handled: false, reason: 'llm-error' })
  assert.equal(calls.send.length, 0)
  assert.equal(state['qq:123'].lastInboundId, '')
  assert.equal(calls.saveState.length, 0)
})

test('LLM 返回空：不发送', async () => {
  const { handler, calls } = makeHandler({ streamText: async () => '' })
  const r = await handler(textEvt())
  assert.deepEqual(r, { handled: false, reason: 'empty-reply' })
  assert.equal(calls.send.length, 0)
})

test('send 抛错：整体捕获、返回 error、不落盘', async () => {
  const { handler, calls, state } = makeHandler({
    send: async () => { throw new Error('发送失败') },
  })
  const r = await handler(textEvt())
  assert.deepEqual(r, { handled: false, reason: 'error' })
  assert.equal(state['qq:123'].lastInboundId, '')
  assert.equal(calls.saveState.length, 0)
})
