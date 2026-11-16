"""Pin GitHub ref to one commit, then register remotely before local activation."""
from datetime import datetime, timezone
import hashlib
import json
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import quote
import uuid
from .contracts import watchlist, validate

REPO = 'Adrian-share/foodmap'
REF = 'fact-18/beijing-content-003'
PATH = 'content/watchlists/beijing.json'

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

class GitHub:
    def __init__(self, token=None, transport=None):
        self.token = token
        self.transport = transport or self.request

    def request(self, url, headers, limit):
        if self.token:
            headers = {**headers, 'Authorization': 'Bearer ' + self.token}
        try:
            # Fixed GitHub API host; never forward credentials across a redirect.
            import urllib.request
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *args, **kwargs):
                    return None
            with urllib.request.build_opener(NoRedirect).open(Request(url, headers=headers), timeout=20) as r:
                data = r.read(limit + 1)
                if len(data) > limit:
                    raise ValueError('github_body_too_large')
                return r.status, data, dict(r.headers)
        except HTTPError as error:
            return error.code, b'', dict(error.headers)

    def read(self, previous=None):
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'foodmap-agent/1'}
        url = f'https://api.github.com/repos/{REPO}/commits/{quote(REF, safe="")}'
        status, raw, _ = self.transport(url, headers, 256 * 1024)
        if status != 200:
            return status, None, None, None
        sha = json.loads(raw)['sha']
        if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha):
            raise ValueError('invalid_commit')
        if previous and previous.get('etag') and previous['github']['commit_sha'] == sha:
            headers['If-None-Match'] = previous['etag']
        headers['Accept'] = 'application/vnd.github.raw+json'
        status, raw, meta = self.transport(f'https://api.github.com/repos/{REPO}/contents/{PATH}?ref={sha}', headers, 512 * 1024)
        if status != 200:
            return status, None, None, meta.get('ETag')
        github = dict(repo=REPO, ref=REF, path=PATH, commit_sha=sha,
                      sha256=hashlib.sha256(raw).hexdigest(), observed_at=now_iso())
        return status, raw, github, meta.get('ETag')

class WatchlistSync:
    def __init__(self, store, register):
        self.store = store
        self.register = register

    def failure(self, error):
        if error == 304:
            value = dict(state='unchanged', checked_at=now_iso(), next_retry_at=time.time() + 900)
        else:
            prev = self.store.get('watchlist_sync', {})
            failures = prev.get('failures', 0) + 1
            code = 'http_' + str(error) if isinstance(error, int) else type(error).__name__
            value = dict(state='github_backoff', error_code=code, failures=failures,
                         checked_at=now_iso(), next_retry_at=time.time() + min(21600, 60 * 2 ** min(failures, 8)))
        self.store.set('watchlist_sync', value)
        return value

    def poll(self, github):
        try:
            status, raw, provenance, etag = github.read(self.store.get('watchlist'))
            if status != 200:
                return self.failure(status)
            return self.ingest(raw, provenance, etag)
        except Exception as error:
            return self.failure(error)

    def ingest(self, raw, github, etag=None):
        try:
            value = watchlist(raw)
            validate('github_revision', github)
            if hashlib.sha256(raw).hexdigest() != github['sha256']:
                raise ValueError('watchlist_hash_mismatch')
        except (ValueError, UnicodeError):
            status = dict(state='invalid_watchlist', checked_at=now_iso(), next_retry_at=time.time() + 900)
            self.store.set('watchlist_sync', status)
            return status
        old = self.store.get('watchlist')
        if old and old['github']['sha256'] == github['sha256']:
            self.store.set('watchlist_sync', dict(state='unchanged', checked_at=now_iso(), next_retry_at=time.time() + 900))
            return dict(state='unchanged')
        pending = self.store.get('pending_revision')
        if not pending:
            op = dict(schema_version=1, operation='watchlist.sync', request_id=str(uuid.uuid4()),
                      github=github, watchlist=value, expected_registry_revision=old['registry_revision'] if old else 0)
            pending = dict(operation=op, etag=etag)
            with self.store.transaction():
                self.store.set('pending_revision', pending)
                self.store.prepare(op['request_id'], op)
        op = pending['operation']
        try:
            receipt = self.register(op)
            if receipt.get('status') != 'committed' or not isinstance(receipt.get('registry_revision'), int):
                raise ValueError('registry_not_committed')
        except Exception as error:
            status = dict(state='blocked_registry', error_code=type(error).__name__, checked_at=now_iso(), next_retry_at=time.time() + 60)
            self.store.set('watchlist_sync', status)
            return status
        with self.store.transaction():
            self.store.finish_receipt(op['request_id'], receipt)
            self.store.set('watchlist', dict(watchlist=op['watchlist'], github=op['github'], etag=pending['etag'], registry_revision=receipt['registry_revision']))
            self.store.set('pending_revision', None)
            self.store.set('sources_due', True)
            self.store.set('watchlist_sync', dict(state='activated', checked_at=now_iso(), next_retry_at=time.time() + 900))
        return dict(state='activated', registry_revision=receipt['registry_revision'])
