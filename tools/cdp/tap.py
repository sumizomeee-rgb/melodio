"""CDP 辅助：对 Android WebView 页面发送一次真实鼠标点击（pointerdown + pointerup）。

用法:
  python tap.py <x> <y> [hold_ms]      # x/y 为 CSS 像素
  python tap.py drag <x1> <y1> <x2> <y2> [steps]   # 按住拖动

需要先 adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
"""
import sys, json, time, urllib.request, websocket

def get_ws():
    with urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10) as resp:
        pages = json.load(resp)
    for p in pages:
        if p.get("type") == "page":
            return p["webSocketDebuggerUrl"]
    raise RuntimeError("no page target found")

def cmd(ws, msg_id, method, params):
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == msg_id:
            return msg

def mouse(ws, mid, etype, x, y, buttons):
    cmd(ws, mid, "Input.dispatchMouseEvent", {
        "type": etype, "x": x, "y": y,
        "button": "left", "buttons": buttons, "clickCount": 1,
    })

def main():
    ws = websocket.create_connection(get_ws(), timeout=30)
    try:
        if sys.argv[1] == "drag":
            x1, y1, x2, y2 = map(float, sys.argv[2:6])
            steps = int(sys.argv[6]) if len(sys.argv) > 6 else 10
            mouse(ws, 1, "mousePressed", x1, y1, 1)
            for i in range(1, steps + 1):
                t = i / steps
                x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
                mouse(ws, 2 + i, "mouseMoved", x, y, 1)
                time.sleep(0.05)
            time.sleep(0.12)
            mouse(ws, 99, "mouseReleased", x2, y2, 0)
            print(f"drag {x1},{y1} -> {x2},{y2} ({steps} steps)")
        else:
            x, y = float(sys.argv[1]), float(sys.argv[2])
            hold = float(sys.argv[3]) / 1000 if len(sys.argv) > 3 else 0.12
            mouse(ws, 1, "mousePressed", x, y, 1)
            time.sleep(hold)
            mouse(ws, 2, "mouseReleased", x, y, 0)
            print(f"tap {x},{y} hold={hold}s")
    finally:
        ws.close()

if __name__ == "__main__":
    main()
