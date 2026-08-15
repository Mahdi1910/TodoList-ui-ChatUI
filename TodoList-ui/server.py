import http.server
import socketserver
import os
import sys
import socket

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PORT = 6846
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    """Find local network IP address (e.g., 192.168.x.x)"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't need to be reachable
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run_server():
    local_ip = get_local_ip()
    try:
        # Binding to "0.0.0.0" allows connections from both localhost and local network devices (e.g. phones)
        with socketserver.TCPServer(("0.0.0.0", PORT), CustomHandler) as httpd:
            print(f"\n==================================================")
            print(f" 🚀 Minimalist To-Do List Server Running!")
            print(f" 💻 Local PC URL:  http://localhost:{PORT}")
            print(f" 📱 Mobile/Network: http://{local_ip}:{PORT}")
            print(f" 📂 Serving dir:   {DIRECTORY}")
            print(f" ⏹️  Press Ctrl+C to stop the server.")
            print(f"==================================================\n")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server stopped gracefully.")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Failed to start server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_server()
