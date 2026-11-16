"""Forced SSH command for the Food Map candidate update service."""
import http.client
import json
import os
import signal
import sys

MAX_BYTES = 2 * 1024 * 1024
# JSON strings may expand when wrapped for transport.
MAX_FRAME_BYTES = MAX_BYTES * 6 + 4096
signal.alarm(40)

def main():
    if os.environ.get('SSH_ORIGINAL_COMMAND'):
        raise ValueError('Only the candidate upload service is available')
    raw = sys.stdin.buffer.read(MAX_FRAME_BYTES + 1)
    if len(raw) > MAX_FRAME_BYTES:
        raise ValueError('Update request exceeds the allowed size')
    request = json.loads(raw)
    if not isinstance(request, dict) or set(request) != {'url', 'method', 'token', 'body'}:
        raise ValueError('Invalid upload request')
    if request['url'] != 'https://foodmap.shareworld.fun/api/admin/content-ingest':
        raise ValueError('Invalid update destination')
    if request['method'] not in ['GET', 'POST']:
        raise ValueError('Invalid update method')
    token = request['token']
    if not isinstance(token, str) or len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
        raise ValueError('Invalid update credential')
    body = request['body']
    if body is not None and (not isinstance(body, str) or len(body.encode('utf-8')) > MAX_BYTES):
        raise ValueError('Invalid candidate payload')
    if request['method'] == 'GET' and body is not None:
        raise ValueError('Invalid read request')
    encoded_body = body.encode('utf-8') if body is not None else None
    connection = http.client.HTTPSConnection('foodmap.shareworld.fun', timeout=25)
    connection.request(request['method'], '/api/admin/content-ingest', body=encoded_body,
                       headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8'})
    response = connection.getresponse()
    content = response.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError('Update response exceeds the allowed size')
    print(json.dumps({'status': response.status, 'body': content.decode('utf-8')}))
    connection.close()

try:
    main()
except Exception:
    print(json.dumps({'status': 502, 'body': 'Candidate update transport failed'}))
    sys.exit(1)
