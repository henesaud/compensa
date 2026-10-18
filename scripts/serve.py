"""Static file server for local development that disables browser caching,
so a normal reload always picks up edited files."""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


# Category pages (/whey, /racao...) are built from index.html
# (scripts/build-site.mjs); locally the same page serves any address without a
# file extension, and script.js picks the category from the path.
class NoCacheHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        translated = super().translate_path(path)
        if '.' not in path.split('?')[0].rsplit('/', 1)[-1] and not os.path.isdir(translated):
            return super().translate_path('/index.html')
        return translated

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
print(f'Serving on http://localhost:{port}')
ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
