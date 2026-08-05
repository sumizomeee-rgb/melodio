import sys, json, websocket

WS = "ws://127.0.0.1:9222/devtools/page/94986C140E11731C6D028AB1DE1F2CA9"

def evaluate(expr, timeout=30):
    ws = websocket.create_connection(WS, timeout=timeout)
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
