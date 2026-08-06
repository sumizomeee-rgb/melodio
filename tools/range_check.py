# -*- coding: utf-8 -*-
"""Range/seek 回归验证：确认 WebView 的 Range 拦截返回的字节没有错位。

历史 bug（v0.5.18 及以前）：MainActivity.handleRangeRequest 自己 skip 到 start，
而 WebView 对 shouldInterceptRequest 返回的流还会再按 Content-Range 丢弃一次 →
实际数据来自 2×start。表现为 seek 后声音错位，且过半后越界读空，
报 PIPELINE_ERROR_READ(FFmpegDemuxer)，元素永久卡在 seeking（"4 分的歌播到 2:33 停死"）。

用法（需先 adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>）：
  python tools/range_check.py          # 校验多个偏移的字节是否与整文件一致
  python tools/range_check.py edge     # 边界用例：末字节 / 闭区间 / 越界终点
"""
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:9222"


def connect():
    from websocket import create_connection

    with urllib.request.urlopen(BASE + "/json", timeout=5) as resp:
        pages = [t for t in json.load(resp) if t.get("type") == "page"]
    if not pages:
        sys.exit("no page target")
    ws = create_connection(pages[0]["webSocketDebuggerUrl"], timeout=180)
    _mid = [0]

    def ev(expr):
        _mid[0] += 1
        ws.send(json.dumps({"id": _mid[0], "method": "Runtime.evaluate",
                            "params": {"expression": expr, "returnByValue": True,
                                       "awaitPromise": True, "timeout": 300000}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == _mid[0]:
                res = msg.get("result", {})
                if res.get("exceptionDetails"):
                    sys.exit(json.dumps(res["exceptionDetails"])[:800])
                return res.get("result", {}).get("value")

    return ev, ws


OFFSETS = r"""
(async () => {
  const url = document.getElementById('audioA').getAttribute('src');
  const full = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const L = full.length;
  const hex = (u8, o, n) => [...u8.slice(o, o + n)].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const offs = [0, 44, 1000, Math.floor(L * 0.25), Math.floor(L * 0.5),
                Math.floor(L * 0.75), Math.floor(L * 0.92)];
  const out = [];
  for (const off of offs) {
    const r = await fetch(url, { headers: { Range: 'bytes=' + off + '-' } });
    const b = new Uint8Array(await r.arrayBuffer());
    let ok = b.length === L - off;
    for (let i = 0; i < 16 && ok; i++) if (b[i] !== full[off + i]) ok = false;
    // 错位时定位数据实际来自哪个偏移（旧 bug 下恒为 2×off）
    let actual = -1;
    if (!ok && b.length >= 16) {
      for (let p = 0; p + 16 <= L; p += 2) {
        let hit = true;
        for (let i = 0; i < 16; i++) if (full[p + i] !== b[i]) { hit = false; break; }
        if (hit) { actual = p; break; }
      }
    }
    out.push({ off, status: r.status, contentRange: r.headers.get('content-range'),
               gotLen: b.length, wantLen: L - off, ok, actualOff: actual,
               ratio: actual > 0 ? +(actual / off).toFixed(3) : null,
               got: hex(b, 0, 8), want: hex(full, off, 8) });
  }
  return { file: url.split('/').pop(), fileLen: L, results: out };
})()
"""

EDGE = r"""
(async () => {
  const url = document.getElementById('audioA').getAttribute('src');
  const full = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const L = full.length;
  const probe = async (label, h, wantFirst, wantLast, wantLen) => {
    const r = await fetch(url, { headers: { Range: h } });
    const b = new Uint8Array(await r.arrayBuffer());
    return { label, header: h, status: r.status,
             contentRange: r.headers.get('content-range'), len: b.length,
             ok: b.length === wantLen && b[0] === wantFirst && b[b.length - 1] === wantLast };
  };
  return [
    await probe('末字节', 'bytes=' + (L - 1) + '-', full[L - 1], full[L - 1], 1),
    await probe('闭区间 100-199', 'bytes=100-199', full[100], full[199], 100),
    await probe('中段闭区间', 'bytes=5000000-5000099', full[5000000], full[5000099], 100),
    await probe('越界终点', 'bytes=1000-' + (L + 9999), full[1000], full[L - 1], L - 1000)
  ];
})()
"""


def main():
    ev, ws = connect()
    mode = sys.argv[1] if len(sys.argv) > 1 else "offsets"
    if mode == "edge":
        rows = ev(EDGE)
        failed = 0
        for r in rows:
            failed += 0 if r["ok"] else 1
            print(f"{'PASS' if r['ok'] else 'FAIL'}  {r['label']:<14} {r['header']:<26} "
                  f"{r['status']} len={r['len']} {r['contentRange']}")
        print(f"\n{len(rows) - failed}/{len(rows)} passed")
    else:
        out = ev(OFFSETS)
        print(f"{out['file']}  ({out['fileLen']} bytes)\n")
        failed = 0
        for r in out["results"]:
            failed += 0 if r["ok"] else 1
            note = ""
            if not r["ok"]:
                note = (f"  <- 数据实际来自 {r['actualOff']} (×{r['ratio']}) "
                        f"got[{r['got']}] want[{r['want']}]")
            print(f"{'PASS' if r['ok'] else 'FAIL'}  off={r['off']:>10}  {r['status']}  "
                  f"len={r['gotLen']}/{r['wantLen']}{note}")
        print(f"\n{len(out['results']) - failed}/{len(out['results'])} passed")
        if failed:
            sys.exit(1)
    ws.close()


if __name__ == "__main__":
    main()
