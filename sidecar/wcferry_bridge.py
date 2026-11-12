#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wcferry_bridge.py — WeChatFerry sidecar：stdio JSON-Lines 协议
# 下行（stdin，每行一条）: {"id":"..","cmd":"..","args":{..}}
# 上行（stdout，每行一条）: {"id":"..","ok":true,"result":..} 或 {"type":"message","msg":{..}}
import json
import sys
import threading


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(level, msg):
    send({"type": "log", "level": level, "msg": msg})


try:
    from wcferry import Wcf
except Exception as e:  # noqa: BLE001
    send({"type": "fatal", "error": f"无法导入 wcferry: {e}"})
    sys.exit(1)

try:
    # block=False：不阻塞等登录，二维码由 get_qrcode 主动取
    wcf = Wcf(host=None, port=10086, debug=False, block=False)
except Exception as e:  # noqa: BLE001
    send({"type": "fatal", "error": f"Wcf 初始化失败: {e}"})
    sys.exit(1)


def msg_to_dict(m):
    return {
        "id": getattr(m, "id", 0),
        "type": getattr(m, "type", 0),
        "is_group": bool(getattr(m, "is_group", False)),
        "roomid": getattr(m, "roomid", ""),
        "sender": getattr(m, "sender", ""),
        "content": getattr(m, "content", ""),
        "extra": getattr(m, "extra", ""),
        "thumb": getattr(m, "thumb", ""),
        "ts": getattr(m, "ts", 0),
        "sign": getattr(m, "sign", ""),
    }


def recv_loop():
    try:
        ok = wcf.enable_receiving_msg()
        if not ok:
            log("error", "enable_receiving_msg 返回 False")
            return
    except Exception as e:  # noqa: BLE001
        log("error", f"enable_receiving_msg 失败: {e}")
        return
    while True:
        try:
            msg = wcf.get_msg(block=True)
        except Exception:
            continue
        if msg is None:
            continue
        send({"type": "message", "msg": msg_to_dict(msg)})


threading.Thread(target=recv_loop, name="WcfRecv", daemon=True).start()

HANDLERS = {
    "get_qrcode": lambda a: wcf.get_qrcode(),
    "is_login": lambda a: bool(wcf.is_login()),
    "get_self_wxid": lambda a: wcf.get_self_wxid(),
    "get_friends": lambda a: wcf.get_friends(),
    "get_contacts": lambda a: wcf.get_contacts(),
    "send_text": lambda a: wcf.send_text(str(a.get("text", "")), str(a.get("receiver", "")), a.get("aters", "")),
    "send_image": lambda a: wcf.send_image(str(a.get("path", "")), str(a.get("receiver", ""))),
    "send_file": lambda a: wcf.send_file(str(a.get("path", "")), str(a.get("receiver", ""))),
    "send_emotion": lambda a: wcf.send_emotion(str(a.get("path", "")), str(a.get("receiver", ""))),
    "get_msg_types": lambda a: wcf.get_msg_types(),
    "get_user_info": lambda a: wcf.get_user_info(),
    "query_sql": lambda a: wcf.query_sql(str(a.get("db", "")), str(a.get("sql", ""))),
    "shutdown": lambda a: (wcf.cleanup(), True)[1],
}

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue
    rid = req.get("id")
    cmd = req.get("cmd")
    args = req.get("args") or {}
    h = HANDLERS.get(cmd)
    if h is None:
        send({"id": rid, "ok": False, "error": f"未知命令: {cmd}"})
        continue
    try:
        result = h(args)
        send({"id": rid, "ok": True, "result": result})
    except Exception as e:  # noqa: BLE001
        send({"id": rid, "ok": False, "error": str(e)})
    if cmd == "shutdown":
        break
