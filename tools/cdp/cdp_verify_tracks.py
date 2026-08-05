import sys, json, websocket, time

WS = "ws://127.0.0.1:9222/devtools/page/FF95D35A9C5F74FE58F21A3556E7DCDB"

def evaluate(expr, timeout=60):
    ws = websocket.create_connection(WS, timeout=timeout)
    try:
        ws.send(json.dumps({
            "id": 1, "method": "Runtime.evaluate",
            "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}
        }))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                r = msg["result"]["result"]
                return r.get("value")
    finally:
        ws.close()

results = []
for idx in range(5):
    evaluate(f"document.querySelectorAll('#trackList > *')[{idx}].click()")
    time.sleep(2.5)
    info = json.loads(evaluate(
        "JSON.stringify({"
        "idx: document.getElementById('trackIndex').textContent,"
        "imgs: [...new Set([...document.querySelectorAll('img')].filter(i => i.naturalWidth>0).map(i => i.naturalWidth+'x'+i.naturalHeight))],"
        "time: Math.round(document.querySelectorAll('audio')[0].currentTime),"
        "paused: document.querySelectorAll('audio')[0].paused"
        "})"))
    results.append(info)
print(json.dumps(results, ensure_ascii=False, indent=1))
