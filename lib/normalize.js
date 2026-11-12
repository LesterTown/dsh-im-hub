// normalize.js — 把 QQ(OneBot) / 微信(WxMsg) 事件归一化成统一 ConversationEvent

// 统一消息模型（与 DESIGN.md §3 一致）
// { platform, contactId, contactName, unifiedId, isGroup, roomId, kind, text, media, ts }

export function fromOneBotPrivate(event, selfId) {
  // OneBot v11 message.private：{ user_id, message: [{type, data}], ... }
  const userId = String(event.user_id ?? '')
  const segs = Array.isArray(event.message) ? event.message : []
  const text = segs
    .filter((s) => s && s.type === 'text')
    .map((s) => s.data && s.data.text)
    .filter(Boolean)
    .join('')
  const kind = classifyOneBot(segs)
  return {
    platform: 'qq',
    contactId: userId,
    contactName: '',
    unifiedId: `qq:${userId}`,
    isGroup: false,
    roomId: '',
    kind: text ? 'text' : kind,
    text,
    media: mediaFromOneBot(segs),
    ts: Date.now(),
    raw: event,
  }
}

export function fromOneBotGroup(event) {
  const groupId = String(event.group_id ?? '')
  const userId = String(event.user_id ?? '')
  const segs = Array.isArray(event.message) ? event.message : []
  const text = segs
    .filter((s) => s && s.type === 'text')
    .map((s) => s.data && s.data.text)
    .filter(Boolean)
    .join('')
  return {
    platform: 'qq',
    contactId: groupId,
    contactName: '',
    unifiedId: `qq:group:${groupId}`,
    isGroup: true,
    roomId: groupId,
    kind: text ? 'text' : classifyOneBot(segs),
    text,
    media: mediaFromOneBot(segs),
    ts: Date.now(),
    senderId: userId,
    raw: event,
  }
}

export function fromWeChat(msg) {
  // WxMsg 字段：id, type, is_group, roomid, sender, content, extra, ts, sign, thumb, xml
  const sender = String(msg.sender ?? '')
  const roomid = String(msg.roomid ?? '')
  const isGroup = Boolean(msg.is_group)
  const text = typeof msg.content === 'string' ? msg.content : ''
  return {
    platform: 'wechat',
    contactId: isGroup ? roomid : sender,
    contactName: '',
    unifiedId: isGroup ? `wechat:group:${roomid}` : `wechat:${sender}`,
    isGroup,
    roomId: isGroup ? roomid : '',
    kind: classifyWeChat(msg.type),
    text,
    media: null,
    ts: msg.ts ? Number(msg.ts) * 1000 : Date.now(),
    senderId: sender,
    raw: msg,
  }
}

export function resolveUnified(evt, identityMap) {
  // identityMap: [{ unified, qq?, wechat? }]
  if (evt.isGroup) return evt.unifiedId // 群聊不做跨平台归并（v1）
  const id = evt.contactId
  for (const row of identityMap || []) {
    if (evt.platform === 'qq' && row.qq && String(row.qq) === id) return row.unified
    if (evt.platform === 'wechat' && row.wechat && String(row.wechat) === id) return row.unified
  }
  return evt.unifiedId
}

function classifyOneBot(segs) {
  const types = new Set(segs.filter((s) => s).map((s) => s.type))
  if (types.has('image')) return 'image'
  if (types.has('record')) return 'voice'
  if (types.has('file')) return 'file'
  if (types.has('face') || types.has('mface')) return 'sticker'
  return 'text'
}

function classifyWeChat(type) {
  // WeChatFerry 常见类型：1=文本 3=图片 34=语音 37=好友请求 49=文件/卡片 47=表情
  switch (Number(type)) {
    case 3: return 'image'
    case 34: return 'voice'
    case 49: return 'file'
    case 47: return 'sticker'
    case 10000: return 'system'
    default: return 'text'
  }
}

function mediaFromOneBot(segs) {
  const img = segs.find((s) => s && s.type === 'image')
  if (img) return { url: img.data && (img.data.url || img.data.file) }
  const file = segs.find((s) => s && s.type === 'file')
  if (file) return { name: file.data && file.data.name, url: file.data && (file.data.url || file.data.file) }
  return null
}
