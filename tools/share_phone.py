#!/usr/bin/env python3
"""Melodio 内网 PWA 分发器：HTTP 引导页 + 受信任后可安装的 HTTPS PWA。"""
from __future__ import annotations

import html
import http.server
import ipaddress
import os
import shutil
import socket
import ssl
import subprocess
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

HTTP_PORT = 8080
HTTPS_PORT = 8443

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "web"
STATE_ROOT = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".local" / "share")) / "MelodioPWA"
CA_KEY = STATE_ROOT / "melodio-root-ca.key"
CA_CERT = STATE_ROOT / "melodio-root-ca.crt"
SERVER_KEY = STATE_ROOT / "melodio-server.key"
SERVER_CSR = STATE_ROOT / "melodio-server.csr"
SERVER_CERT = STATE_ROOT / "melodio-server.crt"
SERVER_EXT = STATE_ROOT / "melodio-server.ext"


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    # Git for Windows 自带的 openssl.exe 运行在 MSYS2 环境；禁止把 /CN=... 当路径改写。
    env.setdefault("MSYS2_ARG_CONV_EXCL", "*")
    return subprocess.run(
        cmd,
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )


def find_lan_ip() -> str:
    # UDP connect 不会真正发包，但能让系统告诉我们默认路由使用的本机地址。
    for target in (("8.8.8.8", 443), ("1.1.1.1", 443)):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(target)
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
        except OSError:
            pass
        finally:
            sock.close()

    candidates: list[str] = []
    try:
        for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = item[4][0]
            if ip not in candidates and not ip.startswith("127."):
                candidates.append(ip)
    except OSError:
        pass
    private = [ip for ip in candidates if ipaddress.ip_address(ip).is_private]
    if private:
        return private[0]
    if candidates:
        return candidates[0]
    raise RuntimeError("无法确定局域网 IPv4 地址")


def find_openssl() -> str:
    found = shutil.which("openssl")
    if found:
        return found
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "usr" / "bin" / "openssl.exe",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "mingw64" / "bin" / "openssl.exe",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Git" / "usr" / "bin" / "openssl.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError(
        "未找到 OpenSSL。安装 Git for Windows 后通常会自带 OpenSSL，或把 openssl.exe 加入 PATH。"
    )


def ensure_ca(openssl: str) -> None:
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    if CA_KEY.is_file() and CA_CERT.is_file():
        return
    run([openssl, "genrsa", "-out", str(CA_KEY), "2048"])
    run([
        openssl, "req", "-x509", "-new", "-key", str(CA_KEY),
        "-sha256", "-days", "3650", "-out", str(CA_CERT),
        "-subj", "/CN=Melodio LAN Root CA",
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
        "-addext", "subjectKeyIdentifier=hash",
    ])


def create_server_cert(openssl: str, lan_ip: str) -> None:
    hostname = socket.gethostname().strip() or "melodio-host"
    SERVER_EXT.write_text(
        "\n".join([
            "basicConstraints=critical,CA:FALSE",
            "keyUsage=critical,digitalSignature,keyEncipherment",
            "extendedKeyUsage=serverAuth",
            f"subjectAltName=IP:{lan_ip},IP:127.0.0.1,DNS:localhost,DNS:{hostname}",
            "",
        ]),
        encoding="utf-8",
    )
    run([openssl, "genrsa", "-out", str(SERVER_KEY), "2048"])
    run([
        openssl, "req", "-new", "-key", str(SERVER_KEY), "-out", str(SERVER_CSR),
        "-subj", f"/CN={lan_ip}",
    ])
    run([
        openssl, "x509", "-req", "-in", str(SERVER_CSR),
        "-CA", str(CA_CERT), "-CAkey", str(CA_KEY), "-CAcreateserial",
        "-out", str(SERVER_CERT), "-days", "825", "-sha256",
        "-extfile", str(SERVER_EXT),
    ])


def trust_ca_on_windows() -> None:
    if os.name != "nt":
        return
    certutil = shutil.which("certutil") or shutil.which("certutil.exe")
    if not certutil:
        return
    result = run([certutil, "-user", "-addstore", "Root", str(CA_CERT)], check=False)
    if result.returncode != 0:
        print("[提示] 无法自动把 Melodio CA 加入当前 Windows 用户信任区，本机浏览器可能仍提示证书风险。")


def setup_html(lan_ip: str, https_port: int) -> bytes:
    https_url = f"https://{lan_ip}:{https_port}/"
    body = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Melodio · 内网安装</title>
<style>
body{{margin:0;background:#0b0b0c;color:#eee;font:16px/1.65 system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh}}
main{{width:min(760px,calc(100% - 36px));padding:28px;border:1px solid #333;border-radius:24px;background:#141416;box-shadow:0 24px 80px #0008}}
h1{{margin:.1em 0 .35em;font-size:30px}}p{{color:#bdbdc4}}.step{{padding:18px 0;border-top:1px solid #2a2a2d}}a{{display:inline-block;margin-top:8px;padding:12px 18px;border-radius:999px;background:#f2eee5;color:#111;text-decoration:none;font-weight:700}}code{{word-break:break-all;color:#e8d7a7}}small{{color:#8f8f97}}
</style></head><body><main>
<h1>Melodio 内网安装</h1>
<p>第一次使用只需要让手机信任这台电脑的局域网证书。以后同一台手机无需重复安装证书。</p>
<div class="step"><b>1. 安装 Melodio 局域网证书</b><br><a href="/melodio-root-ca.crt">下载证书</a><p>Android：下载后到「设置 → 安全/隐私 → 加密与凭据 → 安装证书 → CA 证书」安装。不同品牌菜单名称可能略有不同。</p></div>
<div class="step"><b>2. 打开 Melodio</b><br><a href="{html.escape(https_url)}">打开 HTTPS 版 Melodio</a><p>在 Chrome 菜单里选择「安装应用」/「添加到主屏幕」。安装完成并成功打开一次后，Melodio 程序壳可离线启动。</p></div>
<div class="step"><small>局域网地址：<code>{html.escape(https_url)}</code><br>仅在你信任这台电脑时安装该 CA；不用后可在系统凭据设置中删除 “Melodio LAN Root CA”。</small></div>
</main></body></html>"""
    return body.encode("utf-8")


class SetupHandler(http.server.BaseHTTPRequestHandler):
    lan_ip = "127.0.0.1"
    https_port = HTTPS_PORT

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            payload = setup_html(self.lan_ip, self.https_port)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        if path == "/melodio-root-ca.crt":
            payload = CA_CERT.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/x-x509-ca-cert")
            self.send_header("Content-Disposition", 'attachment; filename="melodio-root-ca.crt"')
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_error(404)


class PwaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            source = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
            marker = '<script src="pwa-bootstrap.js"></script>'
            if marker not in source:
                source = source.replace("</head>", f"  {marker}\n</head>", 1)
            payload = source.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


def make_server(start_port: int, handler: type[http.server.BaseHTTPRequestHandler]) -> tuple[http.server.ThreadingHTTPServer, int]:
    last_error: OSError | None = None
    for port in range(start_port, start_port + 40):
        try:
            return http.server.ThreadingHTTPServer(("0.0.0.0", port), handler), port
        except OSError as exc:
            last_error = exc
    raise RuntimeError(f"端口 {start_port}-{start_port + 39} 均不可用：{last_error}")


def start_server(server: http.server.ThreadingHTTPServer) -> threading.Thread:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread


def copy_to_clipboard(text: str) -> None:
    if os.name != "nt":
        return
    try:
        subprocess.run(["clip"], input=text, text=True, check=False)
    except OSError:
        pass


def main() -> int:
    if not WEB_ROOT.joinpath("index.html").is_file():
        print(f"[错误] 找不到 {WEB_ROOT / 'index.html'}")
        return 1

    try:
        lan_ip = find_lan_ip()
        openssl = find_openssl()
        ensure_ca(openssl)
        create_server_cert(openssl, lan_ip)
        trust_ca_on_windows()
    except Exception as exc:
        print(f"[错误] HTTPS 准备失败：{exc}")
        return 1

    SetupHandler.lan_ip = lan_ip
    try:
        setup_server, http_port = make_server(HTTP_PORT, SetupHandler)
        pwa_server, https_port = make_server(HTTPS_PORT, PwaHandler)
    except Exception as exc:
        print(f"[错误] 局域网端口启动失败：{exc}")
        return 1
    SetupHandler.https_port = https_port

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=SERVER_CERT, keyfile=SERVER_KEY)
    pwa_server.socket = context.wrap_socket(pwa_server.socket, server_side=True)

    start_server(setup_server)
    start_server(pwa_server)

    setup_url = f"http://{lan_ip}:{http_port}/"
    pwa_url = f"https://{lan_ip}:{https_port}/"
    copy_to_clipboard(setup_url)

    print()
    print("=" * 64)
    print("  Melodio 内网 PWA 已启动")
    print("=" * 64)
    print(f"  发给内网手机（首次安装）：{setup_url}")
    print(f"  已信任证书可直接打开：    {pwa_url}")
    print("  首次链接已复制到剪贴板。")
    print("  如果手机打不开，请确认 Windows 防火墙允许 Python 访问专用网络。")
    print("  按 Ctrl+C 停止服务。")
    print("=" * 64)
    print()

    try:
        webbrowser.open(f"https://localhost:{https_port}/")
    except Exception:
        pass

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nMelodio 内网 PWA 已停止。")
    finally:
        setup_server.shutdown()
        pwa_server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
