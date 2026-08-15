#!/usr/bin/env python3
"""Local server for the combined To-Do + ChatUI application.

Real files are served normally. Canonical extensionless application routes fall
back to root index.html so direct refreshes such as /chat-ui/chat/<id> work.
"""

from __future__ import annotations

import argparse
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


def is_spa_route(path: str) -> bool:
    path = path.rstrip("/") or "/"
    return (
        path == "/"
        or path == "/todo-list-ui"
        or path == "/chat-ui"
        or (path.startswith("/chat-ui/chat/") and len(path) > len("/chat-ui/chat/"))
        or path == "/chat"
        or (path.startswith("/chat/") and len(path) > len("/chat/"))
    )


class CombinedHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        self._combined_root = Path(directory).resolve()
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        request_path = unquote(urlsplit(self.path).path)
        translated = Path(self.translate_path(request_path)).resolve()
        try:
            translated.relative_to(self._combined_root)
            inside_root = True
        except ValueError:
            inside_root = False

        if inside_root and translated.exists():
            return super().do_GET()

        if is_spa_route(request_path):
            index = self._combined_root / "index.html"
            if not index.is_file():
                self.send_error(500, "Combined root index.html is missing")
                return
            data = index.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
            return

        self.send_error(404, "File not found")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the combined TodoList-ui + ChatUI app")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--root", default=os.environ.get("APP_ROOT", "."), help="Repository root or built dist directory")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(args.root).resolve()
    if not (root / "index.html").is_file():
        raise SystemExit(f"No index.html found in {root}")

    def handler(*handler_args, **handler_kwargs):
        return CombinedHandler(*handler_args, directory=str(root), **handler_kwargs)

    server = ThreadingHTTPServer((args.host, args.port), handler)
    display_host = "localhost" if args.host in {"0.0.0.0", "::"} else args.host
    print(f"Combined app: http://{display_host}:{args.port}/todo-list-ui")
    print(f"ChatUI:      http://{display_host}:{args.port}/chat-ui")
    print(f"Serving:     {root}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
