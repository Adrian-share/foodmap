import json
from pathlib import Path
import tempfile
import unittest
from test_acceptance import initial, provenance, BV
from foodmap_agent.queue import Store
from foodmap_agent.watchlist import WatchlistSync
from foodmap_agent.scheduler import Scanner

class SourceRemoval(unittest.TestCase):
    def test_removed_season_and_its_pending_views_stop_without_deleting_history(self):
        root = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(dir=root) as tmp:
            q = Store(tmp)
            self.addCleanup(q.close)
            value = initial()
            value['sources'] = value['sources'][:1]
            uid = value['sources'][0]['uid']
            value['sources'][0]['season_ids'] = ['123', '456']
            sync = WatchlistSync(q, lambda op: dict(status='committed', registry_revision=op['expected_registry_revision']+1))
            raw = json.dumps(value).encode();sync.ingest(raw, provenance(raw))
            removed = dict(uid=uid,type='season',id='456')
            kept = dict(uid=uid,type='season',id='123')
            view = dict(uid=uid,type='view',id=BV,origin_keys=[Scanner.key(removed)])
            q.save_cursor(Scanner.key(removed),dict(page=7,next_retry_at=0,last_success={'page':6},failures=0,source=removed))
            q.save_cursor(Scanner.key(kept),dict(page=3,next_retry_at=0,last_success={'page':2},failures=0))
            q.save_cursor(Scanner.key(view),dict(page=1,next_retry_at=0,last_success=None,failures=0,source=view))
            q.discover(uid,BV,1,'historical','kept evidence',1)
            value['sources'][0]['season_ids'] = ['123']
            raw = json.dumps(value).encode();sync.ingest(raw, provenance(raw,'b'*40))
            scanner = Scanner(q, lambda s,p: dict(items=[],reached_end=True,url='https://api.bilibili.com/x/test'))
            plan = scanner.plan()
            self.assertFalse(any(s['id'] in ('456',BV) for s in plan))
            self.assertTrue(any(s['id']=='123' for s in plan))
            self.assertEqual(q.cursor(Scanner.key(kept))['page'],3)
            self.assertEqual(q.cursor(Scanner.key(removed))['page'],7)
            self.assertEqual(len(q.videos()),1)
            self.assertEqual(q.videos()[0]['sources'],['historical'])
