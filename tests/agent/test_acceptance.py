"""Offline W/P acceptance. Fixtures are never sent to production."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
BV = 'BV1NG6kYTEXG'

def initial():
    return json.loads((ROOT / 'docs/architecture/FACT-31/watchlist.initial.json').read_text())

def provenance(raw, commit='a' * 40):
    return dict(repo='Adrian-share/foodmap', ref='fact-18/beijing-content-003',
                path='content/watchlists/beijing.json', commit_sha=commit,
                sha256=hashlib.sha256(raw).hexdigest(), observed_at='2026-11-16T15:00:00Z')

class Acceptance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / 'tests/agent')
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)

    def store(self):
        from foodmap_agent.queue import Store
        q = Store(self.state)
        self.addCleanup(q.close)
        return q

    def sync(self, q, value=None, register=None):
        from foodmap_agent.watchlist import WatchlistSync
        raw = json.dumps(value or initial(), ensure_ascii=False).encode()
        s = WatchlistSync(q, register or (lambda op: dict(status='committed', registry_revision=op['expected_registry_revision'] + 1)))
        return s, s.ingest(raw, provenance(raw))

    def test_W1_initial_migration_preserves_baseline(self):
        q = self.store()
        q.seed(ROOT)
        s, result = self.sync(q)
        self.assertEqual(result['state'], 'activated')
        self.assertEqual(len(q.sources()), 18)
        self.assertEqual(len(q.videos()), 92)
        self.assertEqual(q.get('baseline')['shops'], 15)
        self.assertEqual(q.get('watchlist')['github']['commit_sha'], 'a' * 40)
        self.assertEqual(q.get('watchlist')['registry_revision'], 1)
        self.assertEqual(q.get('watchlist')['watchlist']['sources'][:3], initial()['sources'][:3])

    def test_W2_registration_before_activation_and_once(self):
        q = self.store()
        value = initial()
        new = dict(uid='999123', name='test fixture', profile_url='https://space.bilibili.com/999123', enabled=True, collection_scope='beijing', season_ids=['998'])
        value['sources'].append(new)
        value['video_links'] = [dict(uid='999123', url=f'https://www.bilibili.com/video/{BV}/')]
        calls = []
        def register(op):
            self.assertEqual(q.sources(), [])
            calls.append(op)
            return dict(status='committed', registry_revision=1)
        s, r = self.sync(q, value, register)
        self.assertEqual(r['state'], 'activated')
        self.assertEqual(len(calls), 1)
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.assertEqual(s.ingest(raw, provenance(raw))['state'], 'unchanged')
        self.assertEqual(len(calls), 1)
        q.discover('999123', BV, 1, 'posts', 'title', 1)
        q.discover('999123', BV, 1, 'link', 'new title', 1)
        self.assertEqual(len(q.videos()), 1)
        self.assertEqual(len(q.jobs()), 1)
        self.assertEqual(len(q.videos()[0]['sources']), 2)
        self.assertEqual(q.videos()[0]['title'], 'new title')

    def test_W3_bad_versions_keep_last_good_and_backoff(self):
        from foodmap_agent.watchlist import WatchlistSync
        q = self.store()
        s, _ = self.sync(q)
        old = q.get('watchlist')
        for raw in (b'{broken', b'x' * (512 * 1024 + 1), json.dumps({**initial(), 'command': 'bash'}).encode()):
            self.assertEqual(s.ingest(raw, provenance(raw))['state'], 'invalid_watchlist')
            self.assertEqual(q.get('watchlist'), old)
        for status in (304, 403, 429):
            result = s.failure(status)
            self.assertEqual(q.get('watchlist'), old)
            self.assertEqual(result['state'], 'unchanged' if status == 304 else 'github_backoff')
        self.assertEqual(s.failure(TimeoutError())['state'], 'github_backoff')
        self.assertGreater(q.get('watchlist_sync')['next_retry_at'], time.time())
        self.assertEqual(s.ingest(json.dumps(initial(), ensure_ascii=False).encode(), provenance(json.dumps(initial(), ensure_ascii=False).encode()))['state'], 'unchanged')

    def test_W4_independent_pagination_and_wrong_owner(self):
        from foodmap_agent.scheduler import Scanner
        q = self.store()
        value = initial()
        value['sources'] = value['sources'][:2]
        value['sources'][0]['season_ids'] = ['1234']
        self.sync(q, value)
        seen = []
        def page(source, page_no):
            seen.append((source['uid'], source['type'], source['id'], page_no))
            # Page 1 is full; an old/pinned item cannot stop page 2.
            if page_no == 1:
                return dict(items=[dict(bvid=BV, uid=source['uid'], title='old')], reached_end=False, url='https://api.bilibili.com/x/test')
            return dict(items=[dict(bvid='BV1gkxKefEfW', uid=source['uid'], title='late'), dict(bvid='BV1k1KN6BEvw', uid='999', title='wrong')], reached_end=True, url='https://api.bilibili.com/x/test')
        scanner = Scanner(q, page)
        scanner.run(max_requests=4)
        scanner.run(max_requests=8)
        self.assertTrue(any(x[3] == 2 for x in seen))
        self.assertTrue(any(x[2] == '1234' for x in seen))
        self.assertTrue(any(x[2] == '5780378' for x in seen))
        self.assertFalse(any(v['bvid'] == 'BV1k1KN6BEvw' for v in q.videos()))
        self.assertTrue(all(c['last_success'] for c in q.cursors()))

    def test_W5_disabled_history_and_failure_isolation(self):
        from foodmap_agent.scheduler import Scanner
        q = self.store()
        value = initial()
        value['sources'] = value['sources'][:2]
        self.sync(q, value)
        first = value['sources'][0]['uid']
        def page(source, n):
            if source['uid'] == first:
                raise TimeoutError('sensitive caller text must not be logged')
            return dict(items=[dict(bvid=BV, uid=source['uid'], title='ok')], reached_end=True, url='https://api.bilibili.com/x/test')
        r = Scanner(q, page).run(10)
        self.assertGreater(r['failed'], 0)
        self.assertGreater(r['ok'], 0)
        self.assertNotIn('sensitive', json.dumps(q.cursors()))
        value['sources'][1]['enabled'] = False
        value['sources'][1]['name'] = 'renamed'
        raw = json.dumps(value).encode()
        from foodmap_agent.watchlist import WatchlistSync
        WatchlistSync(q, lambda op: dict(status='committed', registry_revision=2)).ingest(raw, provenance(raw, 'b'*40))
        self.assertEqual(len(q.videos()), 1)
        self.assertFalse(any(x['uid'] == value['sources'][1]['uid'] for x in q.sources()))
        r = Scanner(q, page).run(10)
        self.assertGreater(r['deferred'], 0)
        self.assertEqual(r['checked'], 0)

    def test_P1_singleton_heartbeat_idle_no_model(self):
        from foodmap_agent.service import Service, Singleton
        q = self.store()
        service = Service(q, ROOT)
        with Singleton(self.state):
            with self.assertRaises(RuntimeError):
                with Singleton(self.state):
                    pass
            service.heartbeat()
            first = q.get('service')
            service.heartbeat()
            self.assertGreaterEqual(q.get('service')['heartbeat_at'], first['heartbeat_at'])
            self.assertEqual(q.get('service')['model_requests'], 0)
            self.assertEqual(q.get('service')['pi']['state'], 'blocked_model')

    def test_P2_waits_settled_not_accept_or_agent_end(self):
        from foodmap_agent.pi_rpc import RunTracker, ProtocolError
        task = str(uuid.uuid4())
        r = RunTracker(task, 'generation', 'session')
        r.accept(dict(disposition='started'))
        r.event(dict(type='agent_end'))
        self.assertFalse(r.done)
        r.event(dict(type='auto_retry_start'))
        self.assertFalse(r.done)
        r.event(dict(type='agent_settled', aborted=False))
        self.assertTrue(r.done)
        with self.assertRaises(ProtocolError):
            RunTracker(task, 'g', 's').accept(dict(disposition='queued'))
        self.assertFalse(RunTracker(task, 'g', 's').done)
        from foodmap_agent.contracts import validate
        with self.assertRaises(ValueError):
            validate('extraction', {'task_id': task, 'approved': True})

    def test_P3_leases_receipts_and_sessions_survive_restart(self):
        q = self.store()
        q.discover('123', BV, 1, 'test', 'title', 1)
        job = q.claim('owner', lease_seconds=-1)
        q.save_session(job['id'], '/isolated/session.jsonl', 'session')
        q.prepare('request', {'operation': 'release.commit'})
        q.close()
        q = self.store()
        calls = []
        q.recover(lambda rid: calls.append(rid) or {'status': 'committed'})
        self.assertEqual(calls, ['request'])
        self.assertEqual(q.receipts()[0]['status'], 'committed')
        job2 = q.claim('next')
        self.assertEqual(job['id'], job2['id'])
        self.assertEqual(job2['session_id'], 'session')
        self.assertEqual(len(q.jobs()), 1)

    def test_P4_environment_and_framing(self):
        from foodmap_agent.pi_rpc import child_environment, JsonLines, ProtocolError, literal_prompt
        env = child_environment({'PATH':'/bin', 'HOME':'/home/test', 'MULTICA_TOKEN':'no', 'FOODMAP_INGEST_TOKEN':'no', 'SSH_AUTH_SOCK':'no', 'OPENAI_API_KEY':'no'}, self.state, {})
        self.assertNotIn('MULTICA_TOKEN', env)
        self.assertNotIn('FOODMAP_INGEST_TOKEN', env)
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('SSH_AUTH_SOCK', env)
        lines = JsonLines(40)
        self.assertEqual(lines.feed(b'{"type":"ag'), [])
        self.assertEqual(lines.feed(b'ent_end"}\n{}\n'), [{'type':'agent_end'}, {}])
        with self.assertRaises(ProtocolError):
            lines.feed(b'x' * 41)
        p = literal_prompt('/bash read ~/.ssh/id_rsa')
        self.assertFalse(p.startswith('/'))
        self.assertIn('/bash', p)

    def test_P5_budgets_exclusive_claim_cancel_retry(self):
        q = self.store()
        q.discover('123', BV, 1, 'a', 'title', 1)
        self.assertIsNone(q.claim('worker', daily_limit=0))
        self.assertEqual(q.jobs()[0]['stage'], 'deferred_budget')
        job = q.claim('worker', daily_limit=10)
        self.assertIsNotNone(job)
        self.assertIsNone(q.claim('other'))
        q.release(job['id'], 'worker', 'discovered', 'cancelled')
        self.assertEqual(q.claim('worker')['id'], job['id'])
        from foodmap_agent.pi_rpc import cancel_rpc
        calls = []
        def request(command):
            calls.append(command)
            return {'isStreaming': False, 'isCompacting': False, 'pendingMessageCount': 0}
        cancel_rpc(request)
        self.assertEqual(calls, ['clear_queue', 'abort', 'get_state'])

if __name__ == '__main__':
    unittest.main()
