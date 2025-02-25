import http.server
import urllib.request
from urllib.parse import urlparse
from socketserver import ThreadingMixIn

PORT = 9000
BASE_TILES_PROXY_PATH = "/mapbox-base-tiles/"
VECTOR_TILES_PROXY_PATH = "/gis/"
TARGET_SERVER = "data.humdata.org"

class ThreadingSimpleServer(ThreadingMixIn, http.server.HTTPServer):
    pass

class ProxyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(BASE_TILES_PROXY_PATH) or self.path.startswith(VECTOR_TILES_PROXY_PATH):
            url = urlparse(self.path)
            proxy_url = url._replace(netloc=TARGET_SERVER, scheme='https').geturl()
            self.handle_proxy_request(proxy_url)
        else:
            super().do_GET()
    
    def handle_proxy_request(self, proxy_url):
        try:
            with urllib.request.urlopen(proxy_url) as response:
                self.send_response(response.status)
                for header in response.getheaders():
                    self.send_header(header[0], header[1])
                self.end_headers()
                self.copyfile(response, self.wfile)
        except Exception as e:
            self.send_error(500, f"Error fetching proxy URL: {proxy_url}. Error: {str(e)}")

Handler = ProxyHTTPRequestHandler

with ThreadingSimpleServer(("", PORT), Handler) as httpd:
    print(f"Serving at port {PORT}")
    httpd.serve_forever()