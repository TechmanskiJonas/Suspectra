"""Static server for development, with caching switched off.

Browsers cache the script and stylesheet files aggressively enough that an
edit can go unseen through several reloads, so every response here carries
no-store.

    python tools/devserver.py [port]
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8002


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        if keyword == "Last-Modified":
            return          # without it the browser cannot ask for a 304
        super().send_header(keyword, value)


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving {PORT} with caching disabled")
    httpd.serve_forever()
