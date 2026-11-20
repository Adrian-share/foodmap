import unittest
from tempfile import TemporaryDirectory
from foodmap_agent.queue import Store
from foodmap_agent.status import snapshot
class StatusReport(unittest.TestCase):
    def test_backoff_is_not_reported_as_checked_no_new(self):
        with TemporaryDirectory() as state:
            store=Store(state)
            scan=dict(checked=0,ok=0,failed=0,deferred=18,new=0,skipped_limit=0,checked_at='2026-11-16T16:00:00Z')
            store.set('last_scan',scan)
            report=snapshot(store)['run']
            self.assertEqual(report['outcome'],'backoff_unchecked')
            self.assertEqual(report['sources_checked'],0)
            self.assertTrue(report['partial'])
            store.set('last_scan',{**scan,'checked':1,'ok':1})
            self.assertEqual(snapshot(store)['run']['outcome'],'partial_no_new')
            store.close()
