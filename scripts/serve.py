"""Static file server for local development that disables browser caching,
so a normal reload always picks up edited files."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
print(f'Serving on http://localhost:{port}')
ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
