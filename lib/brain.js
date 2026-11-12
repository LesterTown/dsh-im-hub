// brain.js — 大脑：上下文组装 + LLM 回复 + 长期记忆维护
// 经验（来自方向② dsh-qq-local）：dsh-llm 流 chunk 用 chunk.type（text-delta），
// 终态用 chunk.kind === 'error' | 'aborted'；messages 内容块为 { type:'text', text }。

export function buildMessages({ persona, memoryText, history, incoming }) {
  const messages = []
  const system = [
    persona && persona.trim(),
    memoryText && memoryText.trim() ? `【你对对方的长期了解】\n${memoryText.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  if (system) messages.push({ role: 'system', content: [{ type: 'text', text: system }] })

  for (const turn of history || []) {
    if (turn && turn.user) messages.push({ role: 'user', content: [{ type: 'text', text: turn.user }] })
    if (turn && turn.assistant) messages.push({ role: 'assistant', content: [{ type: 'text', text: turn.assistant }] })
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: incoming }] })
  return messages
}

export async function streamText(ctx, { provider, model, messages }) {
  let llm
  try {
    llm = ctx.get('llm')
  } catch {
    llm = ctx.llm // 属性访问可能抛 without inject，先 get 再回退
  }
  if (!llm || typeof llm.stream !== 'function') {
    throw new Error('LLM 服务不可用（ctx.llm.stream 不存在）')
  }

  const chunks = llm.stream({ provider, model, messages })
  let text = ''
  for await (const chunk of chunks) {
    const type = chunk && (chunk.type ?? chunk.kind)
    if (type === 'error' || type === 'aborted') {
      const msg = chunk.failure && (chunk.failure.message || chunk.failure.code)
      throw new Error(`LLM ${type}: ${msg || '未知错误'}`)
    }
    if (type === 'text-delta') {
      text += chunk.text ?? chunk.delta ?? ''
    }
    // reasoning-delta / block-start / block-end / usage / finish 忽略
  }
  return text.trim()
}

// 把一轮对话合并进长期记忆（简单追加式，v1 不主动做语义压缩）
export function consolidateMemory(memoryText, userText, replyText) {
  const line = `- 对方说：${userText.replace(/\n+/g, ' ').slice(0, 200)}`
  const line2 = `  我回：${replyText.replace(/\n+/g, ' ').slice(0, 200)}`
  const next = (memoryText ? memoryText.trimEnd() + '\n' : '') + line + '\n' + line2 + '\n'
  // 防止无限增长：超过 ~4000 字截掉最旧一半
  if (next.length > 8000) return next.slice(next.length - 6000)
  return next
}
