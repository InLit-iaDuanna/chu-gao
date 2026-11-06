#!/usr/bin/env python3
"""本地预览服务器：显式声明 UTF-8，避免浏览器猜错编码。"""
import http.server
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
ROOT = os.path.dirname(os.path.abspath(__file__))


class Utf8Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        base = super().guess_type(path)
        if base == "text/html":
            return "text/html; charset=utf-8"
        return base

    def end_headers(self):
        # 本地预览禁用缓存，改完刷新即见
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Utf8Handler) as httpd:
    print(f"serving {ROOT} at http://127.0.0.1:{PORT}/", flush=True)
    httpd.serve_forever()
