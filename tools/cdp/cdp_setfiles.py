import sys, json, websocket, time

WS = "ws://127.0.0.1:9222/devtools/page/9E18F58C395E9AA9C807FBD648890835"

class CDP:
    def __init__(self, ws_url=WS):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.msg_id = 0
    def call(self, method, params=None):
        self.msg_id += 1
        mid = self.msg_id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method} error: {msg['error']}")
                return msg.get("result", {})
    def close(self):
        self.ws.close()

def main():
    c = CDP()
    # 1. enable DOM + Runtime
    c.call("DOM.enable")
    c.call("Runtime.enable")
    # 2. get document root
    doc = c.call("DOM.getDocument", {"depth": 2})
    root_id = doc["root"]["nodeId"]
    # 3. find #folderInput
    q = c.call("DOM.querySelector", {"nodeId": root_id, "selector": "#folderInput"})
    node_id = q["nodeId"]
    print("folderInput nodeId:", node_id)
    # 4. remove webkitdirectory attr so individual files are accepted
    js = """
    (() => {
      const inp = document.getElementById('folderInput');
      inp.removeAttribute('webkitdirectory');
      inp.removeAttribute('directory');
      inp.setAttribute('multiple', '');
      return JSON.stringify({attrs: inp.outerHTML.slice(0, 200)});
    })()
    """
    r = c.call("Runtime.evaluate", {"expression": js, "returnByValue": True})
    print("attr fix:", r["result"].get("value"))
    # 5. set files (paths accessible to the app process)
    files = sys.argv[1:]
    res = c.call("DOM.setFileInputFiles", {"nodeId": node_id, "files": files})
    print("setFileInputFiles ok:", res)
    # 6. read back the input's files
    r = c.call("Runtime.evaluate", {
        "expression": "JSON.stringify([...document.getElementById('folderInput').files].map(f => ({name: f.name, size: f.size, type: f.type, rp: f.webkitRelativePath})))",
        "returnByValue": True})
    print("input files:", r["result"].get("value"))
    # 7. dispatch change
    r = c.call("Runtime.evaluate", {
        "expression": "document.getElementById('folderInput').dispatchEvent(new Event('change')); 'change-dispatched'",
        "returnByValue": True})
    print(r["result"].get("value"))
    c.close()

if __name__ == "__main__":
    main()
