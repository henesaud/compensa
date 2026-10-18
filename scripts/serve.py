"""Static file server for local development that disables browser caching,
so a normal reload always picks up edited files."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


# Category pages are built from index.html (scripts/build-site.mjs); locally
# the same page serves them and script.js picks the category from the path.
CATEGORY_PATHS = {'/whey', '/creatina', '/protetor-solar'}


class NoCacheHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.split('?')[0].rstrip('/') in CATEGORY_PATHS:
            path = '/index.html'
        return super().translate_path(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
print(f'Serving on http://localhost:{port}')
ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
