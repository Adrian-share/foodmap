import io,json,unittest
from urllib.error import HTTPError
from foodmap_agent.http_client import read_public_json,PublicHTTPError,PUBLIC_HEADERS
class PublicReads(unittest.TestCase):
    def test_identified_request_and_explicit_403_404_errors(self):
        calls=[]
        class Response(io.BytesIO):
            status=200
        def open_request(request,timeout):
            calls.append(request)
            self.assertEqual(request.get_header('User-agent'),PUBLIC_HEADERS['User-Agent'])
            self.assertEqual(request.get_header('Accept'),'application/json')
            self.assertEqual(timeout,15)
            return Response(b'{"status":"ok"}')
        self.assertEqual(read_public_json('/healthz',opener=open_request),{'status':'ok'})
        for code in (403,404,302):
            def fail(request,timeout):raise HTTPError(request.full_url,code,'restricted',{},None)
            with self.assertRaises(PublicHTTPError) as result:read_public_json('/api/content/current',opener=fail)
            self.assertEqual(result.exception.status,code)
    def test_oversized_public_json_is_rejected(self):
        class Response(io.BytesIO):status=200
        with self.assertRaises(ValueError):read_public_json('/api/content/current',max_bytes=10,opener=lambda *a,**k:Response(b'x'*11))
