# -*- coding: utf-8 -*-
"""CDP 测试脚本:Melodio WebView 的进度条拖动与切歌卡顿压测。

用法:
  python tools/cdp_test.py seek      # 快速连续拖动进度条,验证松手后 UI 与音频同步
  python tools/cdp_test.py switch    # 点击曲目列表跳切(冷加载),测 rAF 最大帧间隔
  python tools/cdp_test.py eval <js> # 单次求值(调试用)

前置:adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
"""
import json
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:9222"


def get_target():
    with urllib.request.urlopen(BASE + "/json", timeout=5) as resp:
        targets = json.load(resp)
    pages = [t for t in targets if t.get("type") == "page"]
    if not pages:
        sys.exit("no page target")
    return pages[0]


def connect():
    from websocket import create_connection

    target = get_target()
    ws = create_connection(target["webSocketDebuggerUrl"], timeout=15)
    _mid = [0]

    def cdp(method, params=None):
        _mid[0] += 1
        ws.send(json.dumps({"id": _mid[0], "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == _mid[0]:
                return msg

    def ev(expr, await_promise=False):
        msg = cdp(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": await_promise},
        )
        r = msg.get("result", {}).get("result", {})
        if "value" in r:
            return r["value"]
        if r.get("type") == "object" and r.get("subtype") == "error":
            return {"__error__": r.get("description")}
        return r

    def mouse(type_, x, y, click=1):
        cdp(
            "Input.dispatchMouseEvent",
            {
                "type": type_,
                "x": round(x),
                "y": round(y),
                "button": "left",
                "pointerType": "mouse",
                "clickCount": click,
            },
        )

    def key(k):
        ev(
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:%r,bubbles:true,cancelable:true}))"
            % k
        )

    return cdp, ev, mouse, key


def ensure_playing(ev, key):
    st = ev(
        "(()=>{const a=[...document.querySelectorAll('audio')];"
        "const playing=a.filter(x=>!x.paused&&!x.ended);"
        "return {anyPlaying:playing.length>0, t1:a[0].currentTime, t2:a[1].currentTime};})()"
    )
    if st.get("anyPlaying"):
        return
    key(" ")
    time.sleep(0.6)


def run_seek(cdp, ev, mouse, key):
    ensure_playing(ev, key)
    ev(
        "(()=>{window.__sk={seeks:0,ends:0,times:[]};"
        "document.querySelectorAll('audio').forEach(a=>{"
        "a.addEventListener('seeking',()=>window.__sk.seeks++);"
        "a.addEventListener('seeked',()=>{window.__sk.ends++;window.__sk.times.push(a.currentTime);});});"
        "return 'probe';})()"
    )
    rect = ev(
        "(()=>{const r=document.querySelector('.progress-track').getBoundingClientRect();"
        "return {left:r.left,top:r.top,width:r.width,height:r.height};})()"
    )
    left, top, width = rect["left"], rect["top"], rect["width"]
    y = top + 5
    # 8 次快速拖动,每次起点递增 10%,终点递增 8%
    for i in range(8):
        x0 = left + width * (0.15 + i * 0.10)
        x1 = left + width * (0.30 + i * 0.08)
        mouse("mousePressed", x0, y)
        for step in range(1, 5):
            time.sleep(0.03)
            mouse("mouseMoved", x0 + (x1 - x0) * step / 5, y)
        time.sleep(0.03)
        mouse("mouseReleased", x1, y)
        time.sleep(0.08)
    time.sleep(1.6)  # 等所有 seek 落地
    res = ev(
        "(()=>{const a=[...document.querySelectorAll('audio')];"
        "const playing=a.find(x=>!x.paused&&!x.ended)||a[0];"
        "const bar=document.querySelector('#progressFill').style.width;"
        "const t=document.querySelector('#currentTime').textContent;"
        "return {seeks:window.__sk.seeks, ends:window.__sk.ends,"
        "lastSeekTimes:window.__sk.times.slice(-8),"
        "audioTime:playing.currentTime, barWidth:bar, timeText:t,"
        "pending:'n/a'};})()"
    )
    print(json.dumps({"type": "seek-report", **res}, ensure_ascii=False))


def run_switch(cdp, ev, mouse, key):
    ensure_playing(ev, key)
    ev(
        "(()=>{window.__sw={maxGap:0,last:performance.now(),n:0,longs:0};"
        "if(window.__swCb)return 'already';"
        "const t=(x)=>{const g=x-window.__sw.last;if(g>window.__sw.maxGap)window.__sw.maxGap=g;"
        "window.__sw.last=x;window.__sw.n++;requestAnimationFrame(t);};"
        "requestAnimationFrame(t);"
        "window.__rejs=0;window.addEventListener('unhandledrejection',()=>window.__rejs++);"
        "window.__longObs=new PerformanceObserver((l)=>l.getEntries().forEach(e=>window.__sw.longs++));"
        "try{window.__longObs.observe({type:'longtask'})}catch(e){}"
        "return 'probe';})()"
    )
    time.sleep(0.5)
    # 曲目列表:点当前行 +3 的按钮(冷加载跳切),共 4 次,间隔 750ms
    ev(
        "(()=>{const rows=[...document.querySelectorAll('.touch-track-row')];"
        "window.__rows=rows.map(r=>({i:+r.dataset.trackIndex,"
        "x:r.getBoundingClientRect().left+r.getBoundingClientRect().width/2,"
        "y:r.getBoundingClientRect().top+r.getBoundingClientRect().height/2}));"
        "return window.__rows.length;})()"
    )
    cur = ev(
        "(()=>{const r=[...document.querySelectorAll('.touch-track-row')].find(x=>x.classList.contains('is-active'));"
        "return r?+r.dataset.trackIndex:-1;})()"
    )
    total = len(ev("window.__rows"))
    for k in range(4):
        target = (cur + 3 * (k + 1)) % total
        row = ev(f"window.__rows[{target}]")
        mouse("mousePressed", row["x"], row["y"])
        time.sleep(0.05)
        mouse("mouseReleased", row["x"], row["y"])
        time.sleep(0.75)
    time.sleep(1.5)
    res = ev(
        "(()=>{const a=[...document.querySelectorAll('audio')];"
        "const playing=a.find(x=>!x.paused&&!x.ended)||a[0];"
        "const toast=document.querySelector('#toast').textContent;"
        "return {maxGap:Math.round(window.__sw.maxGap),frames:window.__sw.n,"
        "longs:window.__sw.longs,rejections:window.__rejs,toast,"
        "audioTime:playing.currentTime,playing:!playing.paused};})()"
    )
    print(json.dumps({"type": "switch-report", **res}, ensure_ascii=False))


def run_seekprobe(cdp, ev, mouse, key):
    """一次拖动后逐 50ms 采样:验证 pendingSeek 把进度条钉在目标值,不闪回旧位置。"""
    ensure_playing(ev, key)
    rect = ev(
        "(()=>{const r=document.querySelector('.progress-track').getBoundingClientRect();"
        "return {left:r.left,top:r.top,width:r.width,height:r.height};})()"
    )
    left, top, width = rect["left"], rect["top"], rect["width"]
    y = top + 5
    x0, x1 = left + width * 0.12, left + width * 0.78
    mouse("mousePressed", x0, y)
    time.sleep(0.06)
    for step in range(1, 6):
        mouse("mouseMoved", x0 + (x1 - x0) * step / 6, y)
        time.sleep(0.03)
    mouse("mouseReleased", x1, y)
    samples = []
    for _ in range(14):
        time.sleep(0.05)
        s = ev(
            "(()=>{const a=[...document.querySelectorAll('audio')];"
            "const p=a.find(x=>!x.paused&&!x.ended)||a[0];"
            "return {t:Math.round(p.currentTime*10)/10,"
            "seeking:p.seeking,bar:document.querySelector('#progressFill').style.width,"
            "txt:document.querySelector('#currentTime').textContent};})()"
        )
        samples.append(s)
    print(json.dumps({"type": "seekprobe-report", "samples": samples}, ensure_ascii=False))


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "seek"
    cdp, ev, mouse, key = connect()
    if mode == "seek":
        run_seek(cdp, ev, mouse, key)
    elif mode == "seekprobe":
        run_seekprobe(cdp, ev, mouse, key)
    elif mode == "switch":
        run_switch(cdp, ev, mouse, key)
    elif mode == "eval":
        print(json.dumps(ev(sys.argv[2]), ensure_ascii=False))


if __name__ == "__main__":
    main()
