import test from 'node:test'
import assert from 'node:assert/strict'
import { fromOneBotPrivate, fromOneBotGroup, fromWeChat, resolveUnified } from '../lib/normalize.js'

test('fromOneBotPrivate 提取文本并归一化', () => {
  const evt = fromOneBotPrivate({
    user_id: 123456789,
    message_id: 999,
    message: [
      { type: 'text', data: { text: '你好' } },
      { type: 'face', data: { id: '1' } },
    ],
  })
  assert.equal(evt.platform, 'qq')
  assert.equal(evt.contactId, '123456789')
  assert.equal(evt.unifiedId, 'qq:123456789')
  assert.equal(evt.isGroup, false)
  assert.equal(evt.roomId, '')
  assert.equal(evt.kind, 'text')
  assert.equal(evt.text, '你好')
})

test('fromOneBotPrivate 纯图片消息 kind=image', () => {
  const evt = fromOneBotPrivate({
    user_id: 1,
    message: [{ type: 'image', data: { url: 'http://x/y.png' } }],
  })
  assert.equal(evt.kind, 'image')
  assert.equal(evt.text, '')
  assert.equal(evt.media.url, 'http://x/y.png')
})

test('fromOneBotGroup 归一化并带群号', () => {
  const evt = fromOneBotGroup({
    group_id: 888,
    user_id: 1,
    message: [{ type: 'text', data: { text: '大家好' } }],
  })
  assert.equal(evt.platform, 'qq')
  assert.equal(evt.isGroup, true)
  assert.equal(evt.contactId, '888')
  assert.equal(evt.roomId, '888')
  assert.equal(evt.unifiedId, 'qq:group:888')
  assert.equal(evt.senderId, '1')
  assert.equal(evt.text, '大家好')
})

test('fromWeChat 私聊归一化', () => {
  const evt = fromWeChat({
    id: 5, type: 1, is_group: false, roomid: '', sender: 'wxid_abc', content: '在吗', ts: 1700000000,
  })
  assert.equal(evt.platform, 'wechat')
  assert.equal(evt.contactId, 'wxid_abc')
  assert.equal(evt.unifiedId, 'wechat:wxid_abc')
  assert.equal(evt.isGroup, false)
  assert.equal(evt.kind, 'text')
  assert.equal(evt.text, '在吗')
  assert.equal(evt.ts, 1700000000000)
})

test('fromWeChat 群聊用 roomid', () => {
  const evt = fromWeChat({ id: 6, type: 1, is_group: true, roomid: 'room@chatroom', sender: 'wxid_x', content: '群消息', ts: 0 })
  assert.equal(evt.isGroup, true)
  assert.equal(evt.contactId, 'room@chatroom')
  assert.equal(evt.unifiedId, 'wechat:group:room@chatroom')
})

test('resolveUnified 跨平台身份映射', () => {
  const map = [{ unified: 'friendA', qq: '123456789', wechat: 'wxid_abc' }]
  const qqEvt = { platform: 'qq', contactId: '123456789', isGroup: false, unifiedId: 'qq:123456789' }
  const wxEvt = { platform: 'wechat', contactId: 'wxid_abc', isGroup: false, unifiedId: 'wechat:wxid_abc' }
  assert.equal(resolveUnified(qqEvt, map), 'friendA')
  assert.equal(resolveUnified(wxEvt, map), 'friendA')
})

test('resolveUnified 未映射回退到平台默认', () => {
  const evt = { platform: 'qq', contactId: '999', isGroup: false, unifiedId: 'qq:999' }
  assert.equal(resolveUnified(evt, []), 'qq:999')
})

test('resolveUnified 群聊不跨平台归并', () => {
  const evt = { platform: 'qq', contactId: '888', isGroup: true, unifiedId: 'qq:group:888' }
  assert.equal(resolveUnified(evt, [{ unified: 'x', qq: '888' }]), 'qq:group:888')
})
