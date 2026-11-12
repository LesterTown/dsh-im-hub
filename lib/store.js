// store.js — 状态/记忆/身份的持久化（全部原子写：临时文件 + rename）
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function atomicWrite(file, data) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function readText(file, fallback = '') {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return fallback
  }
}

// dataDir 布局：
//   state.json                  — 每 unifiedId 的 lastInboundId / lastSentText / lastTs
//   identity.json               — L3 身份映射（数组）
//   memory/<unifiedId>.md       — 长期记忆
//   session/<unifiedId>.json    — 短期最近 N 轮
export function layout(dataDir) {
  ensureDir(dataDir)
  const memoryDir = ensureDir(join(dataDir, 'memory'))
  const sessionDir = ensureDir(join(dataDir, 'session'))
  return {
    state: join(dataDir, 'state.json'),
    identity: join(dataDir, 'identity.json'),
    memoryDir,
    sessionDir,
    memoryFile: (id) => join(memoryDir, `${safeId(id)}.md`),
    sessionFile: (id) => join(sessionDir, `${safeId(id)}.json`),
  }
}

export function safeId(id) {
  return String(id).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 120)
}

export function loadIdentity(file) {
  return readJson(file, [])
}

export function saveIdentity(file, list) {
  atomicWrite(file, list)
}

export function loadState(file) {
  return readJson(file, {})
}

export function saveState(file, state) {
  atomicWrite(file, state)
}

export function loadMemory(file) {
  return readText(file, '')
}

export function saveMemory(file, text) {
  atomicWrite(file, text)
}

export function loadSession(file) {
  return readJson(file, [])
}

export function saveSession(file, turns) {
  atomicWrite(file, turns)
}

export function listIds(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  } catch {
    return []
  }
}
