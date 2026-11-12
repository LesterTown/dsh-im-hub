import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  layout, safeId, atomicWrite, readJson, readText,
  loadState, saveState, loadIdentity, saveIdentity, loadMemory, saveMemory, loadSession, saveSession, listIds,
} from '../lib/store.js'

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'imhub-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('layout 建目录并返回文件路径', () => {
  withDir((dir) => {
    const L = layout(dir)
    assert.ok(existsSync(L.memoryDir))
    assert.ok(existsSync(L.sessionDir))
    assert.equal(L.state, join(dir, 'state.json'))
    assert.equal(L.identity, join(dir, 'identity.json'))
    assert.equal(L.memoryFile('a'), join(dir, 'memory', 'a.md'))
  })
})

test('safeId 过滤非法字符', () => {
  assert.equal(safeId('wx:abc/123'), 'wx_abc_123')
  assert.equal(safeId('friend A'), 'friend_A')
  assert.equal(safeId('中文🎃名'), '中文_名')
})

test('state / identity / memory / session roundtrip', () => {
  withDir((dir) => {
    const L = layout(dir)
    saveState(L.state, { 'a:b': { lastTs: 1 } })
    assert.deepEqual(loadState(L.state), { 'a:b': { lastTs: 1 } })

    saveIdentity(L.identity, [{ unified: 'friendA', qq: '1', wechat: 'wxid_x' }])
    assert.deepEqual(loadIdentity(L.identity), [{ unified: 'friendA', qq: '1', wechat: 'wxid_x' }])

    saveMemory(L.memoryFile('friendA'), '他喜欢猫\n')
    assert.equal(loadMemory(L.memoryFile('friendA')), '他喜欢猫\n')

    saveSession(L.sessionFile('friendA'), [{ user: 'hi', assistant: 'hello' }])
    assert.deepEqual(loadSession(L.sessionFile('friendA')), [{ user: 'hi', assistant: 'hello' }])
  })
})

test('readJson/readText 缺文件回退默认值', () => {
  withDir((dir) => {
    assert.deepEqual(readJson(join(dir, 'nope.json'), { x: 1 }), { x: 1 })
    assert.equal(readText(join(dir, 'nope.md'), 'def'), 'def')
  })
})

test('atomicWrite 写 JSON 字符串均可读回', () => {
  withDir((dir) => {
    const f = join(dir, 'x.json')
    atomicWrite(f, { a: 1 })
    assert.deepEqual(readJson(f, null), { a: 1 })
    atomicWrite(f, 'plain')
    assert.equal(readText(f, ''), 'plain')
  })
})

test('listIds 列出 memory 下的 id', () => {
  withDir((dir) => {
    const L = layout(dir)
    saveMemory(L.memoryFile('a'), 'x')
    saveMemory(L.memoryFile('b'), 'y')
    assert.deepEqual(listIds(L.memoryDir).sort(), ['a', 'b'])
  })
})
