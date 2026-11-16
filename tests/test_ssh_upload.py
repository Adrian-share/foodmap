import io
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'deployment/foodmap-sync/upload.py'
URL = 'https://foodmap.shareworld.fun/api/admin/content-ingest'

class Response:
    status = 200
    def read(self, limit):
        return b'{"revision":1}'

class Connection:
    def __init__(self, target, calls):
        self.target = target
        self.calls = calls
    def request(self, method, url, body=None, headers=None):
        self.calls.append((self.target, method, url, body))
    def getresponse(self):
        return Response()
    def close(self):
        pass

class SshUploadTest(unittest.TestCase):
    def invoke(self, request, command=''):
        raw = json.dumps(request, ensure_ascii=False).encode('utf-8')
        stdout = io.StringIO()
        calls = []
        stdin = type('Input', (), {'buffer': io.BytesIO(raw)})()
        with patch('sys.stdin', stdin), patch('sys.stdout', stdout), patch('signal.alarm'), \
             patch.dict('os.environ', {'SSH_ORIGINAL_COMMAND': command}), \
             patch('http.client.HTTPSConnection', lambda target, **kw: Connection(target, calls)):
            try:
                runpy.run_path(str(SCRIPT), run_name='__main__')
            except SystemExit:
                pass
        return json.loads(stdout.getvalue()), calls

    def envelope(self, body=None):
        return {'url': URL, 'method': 'GET' if body is None else 'POST', 'token': 'a' * 64, 'body': body}

    def test_framed_body_within_worker_limit_is_forwarded(self):
        records = [{'bvid':'BV1NG6kYTEXG','creator_uid':'3546728118618546',
                    'title':'"' * 2000,'discovered_at':'2026-11-16T08:00:00Z',
                    'owner_verified':True,'source':'https://api.bilibili.com/x/web-interface/view?bvid=BV1NG6kYTEXG'}] * 400
        body = json.dumps({'snapshot':{'schema':1,'updated_at':'2026-11-16T08:00:00Z',
                                     'discoveries':records,'accounts':[],'seasons':[],'videos':[]}},
                          separators=(',', ':'), ensure_ascii=False)
        self.assertLess(len(body.encode()), 2 * 1024 * 1024)
        self.assertGreater(len(json.dumps(self.envelope(body)).encode()), 2 * 1024 * 1024)
        result, calls = self.invoke(self.envelope(body))
        self.assertEqual(result['status'], 200)
        self.assertEqual(calls[0][3], body.encode('utf-8'))

    def test_chinese_json_body_uses_utf8_bytes(self):
        body = json.dumps({'title':'北京探店'}, ensure_ascii=False)
        result, calls = self.invoke(self.envelope(body))
        self.assertEqual(result['status'], 200)
        self.assertEqual(calls[0][3], body.encode('utf-8'))

    def test_command_and_foreign_destination_are_rejected(self):
        for envelope, command in [(self.envelope(), 'id'), ({**self.envelope(), 'url':'https://example.com/'}, '')]:
            result, calls = self.invoke(envelope, command)
            self.assertEqual(result['status'], 502)
            self.assertEqual(calls, [])

    def test_inner_body_above_two_mib_is_rejected(self):
        result, calls = self.invoke(self.envelope('x' * (2 * 1024 * 1024 + 1)))
        self.assertEqual(result['status'], 502)
        self.assertEqual(calls, [])

    def test_get_requires_explicit_null_body(self):
        result, calls = self.invoke(self.envelope())
        self.assertEqual(result['status'], 200)
        self.assertIsNone(calls[0][3])

if __name__ == '__main__':
    unittest.main()
