"""HTTPS transport for the unattended updater. Credentials arrive through stdin."""
import json
import sys
from urllib.parse import urlparse
from curl_cffi import requests

request = json.load(sys.stdin)
url = urlparse(request['url'])
if url.scheme != 'https' or url.username or url.password:
    raise ValueError('The content updater requires an HTTPS URL')
headers = {'Authorization': 'Bearer ' + request['token']}
if request.get('body') is not None:
    headers['Content-Type'] = 'application/json'
response = requests.request(
    request['method'], request['url'], headers=headers,
    data=request.get('body'), impersonate='chrome',
    timeout=25, allow_redirects=False, verify=True,
)
print(json.dumps({'status': response.status_code, 'body': response.text[:2097152]}))
