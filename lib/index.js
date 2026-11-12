// index.js — dsh-im-hub 插件入口：Config + apply + 适配器装配 + 回复管线
import { join } from 'node:path'
import { homedir } from 'node:os'
import { env } from 'node:process'

let z = null
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  z = null
}

export const name = 'dsh-im-hub'
export const inject = ['timer']

export const Config = z
  ? z.object({
      enabled: z.boolean().default(false).volatile(),                 // 总开关
      persona: z.string().default('').volatile(),                     // 人设
      provider: z.string().default('deepseek-account').volatile(),
      model: z.string().default('deepseek-v4-pro').volatile(),
      replyCooldownSec: z.number().default(10).volatile(),
      maxHistoryTurns: z.number().default(20).volatile(),
      // QQ
      qqEnabled: z.boolean().default(false).volatile(),
      qqWsUrl: z.string().default('ws://127.0.0.1:3001').volatile(),
      qqToken: z.string().default('').volatile(),
      qqSelfId: z.string().default('').volatile(),
      // 微信
      wxEnabled: z.boolean().default(false).volatile(),
      wxSidecarPath: z.string().default('').volatile(),
    })
  : null

function pick(v) {
  return v && typeof v.get === 'function' ? v.get() : v
}

function readCfg(config) {
  const get = (k) => pick(config[k])
  return {
    enabled: !!get('enabled'),
    persona: String(get('persona') || ''),
    provider: String(get('provider') || 'deepseek-account'),
    model: String(get('model') || 'deepseek-v4-pro'),
    replyCooldownSec: Math.max(0, Number(get('replyCooldownSec')) || 0),
    maxHistoryTurns: Math.max(1, Number(get('maxHistoryTurns')) || 20),
    qqEnabled: !!get('qqEnabled'),
    qqWsUrl: String(get('qqWsUrl') || 'ws://127.0.0.1:3001'),
    qqToken: String(get('qqToken') || ''),
    qqSelfId: String(get('qqSelfId') || ''),
    wxEnabled: !!get('wxEnabled'),
    wxSidecarPath: String(get('wxSidecarPath') || ''),
  }
}

function resolveDataDir(ctx) {
  if (env.DSH_IM_HUB_DATA) return env.DSH_IM_HUB_DATA
  let base = null
  try {
    base = ctx.get('baseDir')
  } catch {}
  if (base) return join(base, 'dsh-im-hub')
  return join(homedir(), '.dsh', 'dsh-im-hub')
}

export async function apply(ctx, config) {
  const logger = (ctx.logger && typeof ctx.logger.info === 'function') ? ctx.logger : console
  const { ensureDir, layout, loadState, saveState, loadIdentity, loadMemory, saveMemory, loadSession, saveSession } = await import('./store.js')
  const { resolveUnified } = await import('./normalize.js')
  const { buildMessages, streamText, consolidateMemory } = await import('./brain.js')
  const { createReplyHandler } = await import('./pipeline.js')
  const { QQAdapter } = await import('./adapters/qq.js')
  const { WeChatAdapter } = await import('./adapters/wechat.js')

  const dir = resolveDataDir(ctx)
  ensureDir(dir)
  const L = layout(dir)
  let identityMap = loadIdentity(L.identity)
  let state = loadState(L.state)
  let adapters = { qq: null, wechat: null }
  let queue = []
  let processing = false

  function onEvent(evt) {
    const cfg = readCfg(config)
    if (!cfg.enabled) return
    evt.unifiedId = resolveUnified(evt, identityMap)
    queue.push(evt)
    drain()
  }

  async function drain() {
    if (processing) return
    processing = true
    try {
      while (queue.length) {
        const evt = queue.shift()
        const r = await handleEvent(evt)
        if (r && r.handled) logger.info(`[dsh-im-hub] 已回复 ${evt.platform}:${evt.contactId}`)
      }
    } finally {
      processing = false
    }
  }

  const handleEvent = createReplyHandler({
    getCfg: () => readCfg(config),
    state,
    loadMemory: (id) => loadMemory(L.memoryFile(id)),
    saveMemory: (id, text) => saveMemory(L.memoryFile(id), text),
    loadSession: (id) => loadSession(L.sessionFile(id)),
    saveSession: (id, turns) => saveSession(L.sessionFile(id), turns),
    saveState: (s) => saveState(L.state, s),
    buildMessages,
    streamText,
    consolidateMemory,
    send: async (platform, contactId, reply) => {
      if (platform === 'qq') await adapters.qq.sendPrivate(contactId, reply)
      else if (platform === 'wechat') await adapters.wechat.sendText(contactId, reply)
      else throw new Error(`未知平台 ${platform}`)
    },
    ctx,
    logger,
  })

  function reconcile() {
    const cfg = readCfg(config)
    // 身份映射文件热加载
    identityMap = loadIdentity(L.identity)

    if (cfg.enabled && cfg.qqEnabled && !adapters.qq) {
      adapters.qq = new QQAdapter({
        wsUrl: cfg.qqWsUrl,
        token: cfg.qqToken,
        selfId: cfg.qqSelfId,
        onEvent,
        logger,
      })
      adapters.qq.start().catch((e) => logger.warn(`[dsh-im-hub] qq 启动失败: ${e.message}`))
    } else if ((!cfg.enabled || !cfg.qqEnabled) && adapters.qq) {
      adapters.qq.stop()
      adapters.qq = null
    }

    if (cfg.enabled && cfg.wxEnabled && !adapters.wechat) {
      const sidecarPath = cfg.wxSidecarPath || join(import.meta.dirname, '..', 'sidecar', 'wcferry_bridge.py')
      adapters.wechat = new WeChatAdapter({
        sidecarPath,
        onEvent,
        onQr: (qr) => logger.info(`[dsh-im-hub] 微信登录二维码已生成（base64，长度 ${qr.length}）`),
        logger,
      })
      adapters.wechat.start().catch((e) => logger.warn(`[dsh-im-hub] wx 启动失败: ${e.message}`))
    } else if ((!cfg.enabled || !cfg.wxEnabled) && adapters.wechat) {
      adapters.wechat.stop()
      adapters.wechat = null
    }
  }

  reconcile()
  const timer = ctx.interval(reconcile, 5000)
  logger.info(`[dsh-im-hub] 已加载，dataDir=${dir}，心跳 5s`)

  return () => {
    timer && timer()
    adapters.qq && adapters.qq.stop()
    adapters.wechat && adapters.wechat.stop()
  }
}
