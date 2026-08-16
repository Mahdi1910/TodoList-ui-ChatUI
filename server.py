#!/usr/bin/env python3
"""Serve the built combined app from dist/ with shell-only SPA fallbacks."""

from __future__ import annotations

import argparse
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
SHELL_ROUTE = re.compile(r"^/(?:$|todo-list-ui/?$|chat-ui/?$|chat-ui/chat/[^/]+/?$)")


class CombinedAppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if SHELL_ROUTE.fullmatch(path):
            self.path = "/index.html"
        return super().do_GET()

    def do_HEAD(self):
        path = urlparse(self.path).path
        if SHELL_ROUTE.fullmatch(path):
            self.path = "/index.html"
        return super().do_HEAD()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    if not DIST.is_dir():
        raise SystemExit("dist/ does not exist. Run: node scripts/build-static.mjs")

    server = ThreadingHTTPServer((args.host, args.port), CombinedAppHandler)
    print(f"Serving combined app from {DIST} at http://{args.host}:{args.port}")
    print("For phone microphone/Live Voice testing, use the real HTTPS deployment or an HTTPS local setup.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
