"""Identified, bounded public reads. A 403/404 is an error, never an empty release."""
import json
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

PUBLIC_HEADERS = {'User-Agent':'FoodmapContentAgent/1.0 (+https://github.com/Adrian-share/foodmap)', 'Accept':'application/json'}
ORIGIN = 'https://foodmap.shareworld.fun'

class PublicHTTPError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__('public_http_' + str(status))

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def read_public_json(path, *, opener=None, max_bytes=32*1024*1024):
    if not (path=='/healthz' or path.startswith('/api/content/')) or '#' in path or '\\' in path:
        raise ValueError('invalid_public_path')
    request=Request(ORIGIN+path, headers=PUBLIC_HEADERS)
    open_request=opener or build_opener(NoRedirect).open
    try:
        with open_request(request,timeout=15) as response:
            if response.status != 200:
                raise PublicHTTPError(response.status)
            raw=response.read(max_bytes+1)
            if len(raw)>max_bytes:
                raise ValueError('public_body_too_large')
            return json.loads(raw)
    except HTTPError as error:
        raise PublicHTTPError(error.code) from None
