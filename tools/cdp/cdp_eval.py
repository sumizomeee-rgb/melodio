import sys, json, urllib.request, websocket

def get_ws():
    """从 /json 自动发现当前页面 target（重启 app 后 id 会变）"""
    with urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10) as resp:
        pages = json.load(resp)
    for p in pages:
        if p.get("type") == "page":
            return p["webSocketDebuggerUrl"]
    raise RuntimeError("no page target found")

def evaluate(expr, timeout=30):
    ws = websocket.create_connection(get_ws(), timeout=timeout)
    try:
        ws.send(json.dumps({
            "id": 1, "method": "Runtime.evaluate",
            "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}
        }))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                if "error" in msg:
                    return {"error": msg["error"]}
                return msg["result"]["result"]
    finally:
        ws.close()

if __name__ == "__main__":
    expr = sys.argv[1]
    r = evaluate(expr)
    print(json.dumps(r, ensure_ascii=False, indent=2))
