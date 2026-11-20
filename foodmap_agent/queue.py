"""SQLite is the business source of truth; never recover it from Pi context."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import time
import uuid

STAGES = ('discovered', 'cleaning', 'verifying', 'pending', 'staged', 'published',
          'blocked_model', 'blocked_capture', 'deferred_budget', 'failed')

class Store:
    def __init__(self, state):
        self.root = Path(state).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.root / 'queue.sqlite3', isolation_level=None, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS service_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS videos(bvid TEXT PRIMARY KEY, uid TEXT NOT NULL, title TEXT NOT NULL, sources TEXT NOT NULL, baseline_status TEXT);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, bvid TEXT NOT NULL, part INTEGER NOT NULL, rules_version TEXT NOT NULL,
          uid TEXT NOT NULL, stage TEXT NOT NULL, registry_revision INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
          lease_owner TEXT, lease_until REAL, next_retry_at REAL NOT NULL DEFAULT 0, error_code TEXT,
          session_path TEXT, session_id TEXT, proposal TEXT, UNIQUE(bvid,part,rules_version));
        CREATE TABLE IF NOT EXISTS source_cursors(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts(request_id TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL, receipt TEXT);
        CREATE TABLE IF NOT EXISTS attempts(task_id TEXT, day TEXT, started_at REAL);
        CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, value TEXT NOT NULL);
        ''')

    def close(self):
        if self.db:
            self.db.close()
            self.db = None

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM service_state WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set(self, key, value):
        self.db.execute('INSERT INTO service_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, json.dumps(value)))

    def seed(self, root):
        if self.get('baseline'):
            return
        data = json.loads((Path(root) / 'content/compiled.json').read_text())
        with self.transaction():
            for v in data['ledger']['videos']:
                self.db.execute('INSERT OR IGNORE INTO videos VALUES (?,?,?,?,?)',
                                (v['bvid'], v['creator_uid'], v['title'], json.dumps(v['sources']), v['status']))
            shops = {v['shop_id'] for v in data['baseline_records']}
            shops.update(v['store_id'] for b in data['batches'] for r in b['records']
                         if r['review']['status'] == 'approved' for v in [r['visit']])
            self.set('baseline', dict(videos=len(data['ledger']['videos']), shops=len(shops), version=data['version']))

    def sources(self):
        active = self.get('watchlist', {})
        return [s for s in active.get('watchlist', {}).get('sources', []) if s['enabled']]

    def videos(self):
        return [dict(r, sources=json.loads(r['sources'])) for r in self.db.execute('SELECT * FROM videos ORDER BY bvid')]

    def jobs(self):
        return [dict(r) for r in self.db.execute('SELECT * FROM jobs ORDER BY rowid')]

    def discover(self, uid, bvid, part, source, title, revision):
        with self.transaction():
            old = self.db.execute('SELECT * FROM videos WHERE bvid=?', (bvid,)).fetchone()
            if old and old['uid'] != uid:
                return False
            sources = set(json.loads(old['sources']) if old else [])
            sources.add(source)
            self.db.execute('INSERT INTO videos VALUES (?,?,?,?,NULL) ON CONFLICT(bvid) DO UPDATE SET title=excluded.title,sources=excluded.sources',
                            (bvid, uid, title or (old['title'] if old else bvid), json.dumps(sorted(sources))))
            if not old or old['baseline_status'] != 'published':
                self.db.execute('INSERT OR IGNORE INTO jobs(id,bvid,part,rules_version,uid,stage,registry_revision) VALUES (?,?,?,?,?,?,?)',
                                (str(uuid.uuid4()), bvid, part, 'v1', uid, 'discovered', revision))
            return not old

    def cursor(self, key):
        row = self.db.execute('SELECT value FROM source_cursors WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else dict(page=1, next_retry_at=0, last_success=None, failures=0)

    def save_cursor(self, key, value):
        self.db.execute('INSERT INTO source_cursors VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, json.dumps(value)))

    def cursors(self):
        return [dict(key=r['key'], **json.loads(r['value'])) for r in self.db.execute('SELECT * FROM source_cursors ORDER BY key')]

    def claim(self, owner, lease_seconds=300, daily_limit=10, max_attempts=3):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        day = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
        now = time.time()
        with self.transaction():
            # The Pi global event stream permits one in-flight business job only.
            if self.db.execute('SELECT 1 FROM jobs WHERE lease_owner IS NOT NULL AND lease_until>?', (now,)).fetchone():
                return None
            used = self.db.execute('SELECT COUNT(*) FROM attempts WHERE day=?', (day,)).fetchone()[0]
            if used >= daily_limit:
                self.db.execute("UPDATE jobs SET stage='deferred_budget' WHERE stage IN ('discovered','deferred_budget') AND lease_owner IS NULL")
                return None
            row = self.db.execute("SELECT * FROM jobs WHERE stage IN ('discovered','deferred_budget','blocked_model') AND next_retry_at<=? AND attempt<? AND lease_owner IS NULL ORDER BY rowid LIMIT 1", (now, max_attempts)).fetchone()
            if not row:
                return None
            self.db.execute("UPDATE jobs SET stage='cleaning',lease_owner=?,lease_until=?,attempt=attempt+1 WHERE id=?", (owner, now + lease_seconds, row['id']))
            self.db.execute('INSERT INTO attempts VALUES (?,?,?)', (row['id'], day, now))
            return dict(self.db.execute('SELECT * FROM jobs WHERE id=?', (row['id'],)).fetchone())

    def release(self, task_id, owner, stage, error=None, retry_at=0, proposal=None):
        if stage not in STAGES:
            raise ValueError('invalid_stage')
        self.db.execute('UPDATE jobs SET stage=?,error_code=?,next_retry_at=?,proposal=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?',
                        (stage, error, retry_at, json.dumps(proposal) if proposal else None, task_id, owner))

    def save_session(self, task_id, path, session_id):
        self.db.execute('UPDATE jobs SET session_path=?,session_id=? WHERE id=?', (path, session_id, task_id))

    def prepare(self, request_id, body):
        raw = json.dumps(body, sort_keys=True, separators=(',', ':'))
        row = self.db.execute('SELECT body FROM receipts WHERE request_id=?', (request_id,)).fetchone()
        if row and row[0] != raw:
            raise ValueError('idempotency_conflict')
        self.db.execute("INSERT OR IGNORE INTO receipts VALUES (?,?,'prepared',NULL)", (request_id, raw))

    def finish_receipt(self, request_id, receipt):
        self.db.execute('UPDATE receipts SET status=?,receipt=? WHERE request_id=?', (receipt['status'], json.dumps(receipt), request_id))

    def receipts(self):
        return [dict(r) for r in self.db.execute('SELECT * FROM receipts')]

    def recover(self, lookup):
        # Reconcile writes BEFORE recovering job leases. Network failure aborts recovery.
        for row in self.receipts():
            if row['status'] == 'prepared':
                receipt = lookup(row['request_id'])
                if receipt['status'] in ('committed', 'complete'):
                    self.finish_receipt(row['request_id'], receipt)
        with self.transaction():
            self.db.execute("UPDATE jobs SET stage=CASE WHEN stage='cleaning' THEN 'discovered' ELSE stage END,lease_owner=NULL,lease_until=NULL WHERE lease_until<?", (time.time(),))
