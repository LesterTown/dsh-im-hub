import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMessages, streamText, consolidateMemory } from '../lib/brain.js'

test('buildMessages 组装 system + 历史 + 新消息', () => {
  const msgs = buildMessages({
    persona: '你是朋友',
    memoryText: '他喜欢猫',
    history: [{ user: 'a', assistant: 'b' }],
    incoming: '在吗',
  })
  assert.equal(msgs[0].role, 'system')
  assert.match(msgs[0].content[0].text, /你是朋友/)
  assert.match(msgs[0].content[0].text, /他喜欢猫/)
  assert.equal(msgs[1].role, 'user')
  assert.equal(msgs[1].content[0].text, 'a')
  assert.equal(msgs[2].role, 'assistant')
  assert.equal(msgs[2].content[0].text, 'b')
  assert.equal(msgs[3].role, 'user')
  assert.equal(msgs[3].content[0].text, '在吗')
})

test('buildMessages 无 persona/无记忆时不加 system', () => {
  const msgs = buildMessages({ persona: '', memoryText: '', history: [], incoming: 'hi' })
  assert.equal(msgs[0].role, 'user')
  assert.equal(msgs.length, 1)
})

test('streamText 拼接 text-delta（chunk.type）并忽略其它', async () => {
  const chunks = [
    { type: 'block-start', blockType: 'text' },
    { type: 'reasoning-delta', text: '（思考中）' },
    { type: 'text-delta', text: '你好' },
    { type: 'text-delta', text: '呀' },
    { type: 'usage' },
    { type: 'finish' },
  ]
  const ctx = {
    get: () => ({ stream: async function* () { for (const c of chunks) yield c } }),
  }
  const text = await streamText(ctx, { provider: 'x', model: 'y', messages: [] })
  assert.equal(text, '你好呀')
})

test('streamText 兼容 text-delta 用 delta 字段', async () => {
  const ctx = {
    get: () => ({ stream: async function* () { yield { type: 'text-delta', delta: 'fallback' } } }),
  }
  assert.equal(await streamText(ctx, { provider: 'x', model: 'y', messages: [] }), 'fallback')
})

test('streamText error chunk 抛错并带 failure 信息', async () => {
  const ctx = {
    get: () => ({ stream: async function* () { yield { kind: 'error', failure: { message: 'RATE_LIMIT' } } } }),
  }
  await assert.rejects(
    () => streamText(ctx, { provider: 'x', model: 'y', messages: [] }),
    /RATE_LIMIT/,
  )
})

test('streamText aborted chunk 抛错', async () => {
  const ctx = {
    get: () => ({ stream: async function* () { yield { kind: 'aborted', failure: { code: 'CANCELLED' } } } }),
  }
  await assert.rejects(
    () => streamText(ctx, { provider: 'x', model: 'y', messages: [] }),
    /CANCELLED/,
  )
})

test('streamText 无 llm 服务时抛错', async () => {
  const ctx = { get: () => ({}) }
  await assert.rejects(() => streamText(ctx, { provider: 'x', model: 'y', messages: [] }), /LLM 服务不可用/)
})

test('consolidateMemory 追加一轮对话', () => {
  const m = consolidateMemory('', '你吃了吗', '吃了，你呢')
  assert.match(m, /你吃了吗/)
  assert.match(m, /吃了，你呢/)
  // 再次追加不丢旧内容
  const m2 = consolidateMemory(m, '睡了', '晚安')
  assert.match(m2, /你吃了吗/)
  assert.match(m2, /晚安/)
})
