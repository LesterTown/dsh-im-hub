// pipeline.js — 回复管线核心（与适配器 / DSH ctx 解耦，可单测）
//
// 负责：接收归一化后的 ConversationEvent → 去重/冷却 → 组装上下文 → 调 LLM → 回发 → 持久化。
// 与 DESIGN.md §5 的「大脑」对应。所有外部依赖都通过 deps 注入，便于在 macOS 上单测。

export function createReplyHandler(deps) {
  const {
    getCfg,             // () => { persona, provider, model, replyCooldownSec, maxHistoryTurns }
    state,              // 可变引用：{ unifiedId: { lastInboundId, lastSentText, lastTs } }
    loadMemory,         // (id) => string
    saveMemory,         // (id, text) => void
    loadSession,        // (id) => [{ user, assistant }]
    saveSession,        // (id, turns) => void
    saveState,          // (state) => void
    buildMessages,      // ({ persona, memoryText, history, incoming }) => messages
    streamText,         // (ctx, { provider, model, messages }) => Promise<string>
    consolidateMemory,  // (memoryText, userText, assistantText) => string
    send,               // async (platform, contactId, reply) => void
    ctx,                // 透传给 streamText
    logger,
  } = deps

  return async function handleEvent(evt) {
    try {
      if (evt.isGroup) return { handled: false, reason: 'group' }
      if (evt.kind !== 'text' || !evt.text) return { handled: false, reason: 'non-text' }

      const cfg = getCfg()
      const id = evt.unifiedId
      const rec = state[id] || (state[id] = { lastInboundId: '', lastSentText: '', lastTs: 0 })

      // 去重：同一 inbound id 只回一次
      const inboundId = String((evt.raw && (evt.raw.message_id ?? evt.raw.id)) ?? evt.ts ?? '')
      if (inboundId && rec.lastInboundId === inboundId) return { handled: false, reason: 'dup' }
      if (Date.now() - rec.lastTs < cfg.replyCooldownSec * 1000) return { handled: false, reason: 'cooldown' }

      const memoryText = loadMemory(id)
      const history = loadSession(id).slice(-cfg.maxHistoryTurns)
      const messages = buildMessages({ persona: cfg.persona, memoryText, history, incoming: evt.text })

      let reply
      try {
        reply = await streamText(ctx, { provider: cfg.provider, model: cfg.model, messages })
      } catch (e) {
        logger.warn(`[dsh-im-hub] LLM 失败: ${e && e.message}`)
        return { handled: false, reason: 'llm-error' }
      }
      if (!reply) return { handled: false, reason: 'empty-reply' }

      await send(evt.platform, evt.contactId, reply)

      rec.lastInboundId = inboundId
      rec.lastSentText = reply
      rec.lastTs = Date.now()
      saveState(state)

      const turns = history.concat([{ user: evt.text, assistant: reply }]).slice(-cfg.maxHistoryTurns)
      saveSession(id, turns)
      saveMemory(id, consolidateMemory(memoryText, evt.text, reply))
      return { handled: true, reply }
    } catch (e) {
      logger.warn(`[dsh-im-hub] handleEvent 失败: ${e && e.message}`)
      return { handled: false, reason: 'error' }
    }
  }
}
