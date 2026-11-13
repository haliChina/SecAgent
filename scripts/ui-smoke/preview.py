"""Test-only production-renderer preview. Never starts Electron or real IPC."""
import argparse
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--renderer', type=Path, default=HERE.parents[1] / 'out/renderer')
parser.add_argument('--baseline', type=Path)
parser.add_argument('--axe', type=Path)
parser.add_argument('--port', type=int, default=8792)
args = parser.parse_args()
renderer = args.renderer.resolve()
csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
config = "window.__UI_SMOKE_OPTIONS={origin:location.origin,theme:new URLSearchParams(location.search).get('theme')||'dark',scenario:new URLSearchParams(location.search).get('scenario')||''};window.__previewErrors=[];addEventListener('error',e=>__previewErrors.push(e.message));addEventListener('unhandledrejection',e=>__previewErrors.push(String(e.reason)));"

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('Host') != f'127.0.0.1:{args.port}':
            self.send_error(403)
            return
        path = unquote(urlparse(self.path).path)
        root = renderer
        if path.startswith('/baseline/') and args.baseline:
            root = args.baseline.resolve()
            path = path[len('/baseline'):]
        if path == '/fixture-config.js':
            data, mime = config.encode(), 'text/javascript'
        elif path in ('/bridge-mock.js', '/native-checks.js', '/integration-checks.js', '/fix-checks.js', '/round2-checks.js'):
            data, mime = (HERE / path.lstrip('/')).read_bytes(), 'text/javascript'
        elif path == '/axe.js' and args.axe:
            data, mime = args.axe.read_bytes(), 'text/javascript'
        else:
            target = (root / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                self.send_error(404)
                return
            data = target.read_bytes()
            mime = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
            if target.name == 'index.html':
                # Served HTML only: the production build remains byte-for-byte unchanged.
                data = data.replace(b'<head>', b'<head><script src="/fixture-config.js?v=round2"></script><script src="/bridge-mock.js?v=round2"></script>')
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', csp)
        self.send_header('Permissions-Policy', 'microphone=(), camera=(), geolocation=()')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

if __name__ == '__main__':
    print(f'Isolated renderer: http://127.0.0.1:{args.port}/index.html', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
