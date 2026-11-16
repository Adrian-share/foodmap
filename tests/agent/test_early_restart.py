"""A supervised restart can happen before the crashed worker's lease expires."""
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from foodmap_agent.queue import Store
from foodmap_agent.service import Service

ROOT = Path(__file__).resolve().parents[2]


class EarlyRestart(unittest.TestCase):
    def test_serve_reclaims_after_expiry_without_second_restart(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'tests/agent') as tmp:
            store = Store(tmp)
            self.addCleanup(store.close)
            store.seed(ROOT)
            store.discover('613814196', 'BV1ZZ4111111', 1, 'fixture', 'fixture', 1)
            job = store.claim('crashed-owner', lease_seconds=5)
            store.save_session(job['id'], '/isolated/session.jsonl', 'original-session')
            clock = [time.time()]
            service = Service(store, ROOT)
            service.model = {'provider': 'fixture', 'model': 'fixture'}
            service.next_watchlist_at = service.next_source_at = float('inf')
            claims = []
            claim = store.claim

            def tick(_seconds):
                clock[0] += 1
                if clock[0] > job['lease_until'] + 15:
                    service.stop_requested = True

            def record_claim(*args, **kwargs):
                claimed = claim(*args, **kwargs)
                claims.append(claimed)
                return claimed

            def finish(*args, **kwargs):
                service.stop_requested = True
                return {'fixture': True}

            service.pi = Mock()
            service.pi.run.side_effect = finish

            with patch('time.time', side_effect=lambda: clock[0]), \
                    patch('time.sleep', side_effect=tick), \
                    patch.object(service, 'ensure_pi'), \
                    patch.object(service, 'start_pi'), \
                    patch.object(service, 'heartbeat'), \
                    patch.object(store, 'claim', side_effect=record_claim):
                service.serve()

            self.assertIsNone(claims[0], 'the old lease must remain exclusive until expiry')
            recovered = [claim for claim in claims if claim]
            self.assertEqual(len(recovered), 1)
            self.assertEqual(recovered[0]['id'], job['id'])
            self.assertEqual(recovered[0]['session_id'], 'original-session')
            self.assertEqual(store.jobs()[0]['stage'], 'verifying')
            self.assertIsNone(store.jobs()[0]['lease_owner'])

    def test_unconfirmed_write_is_reconciled_before_reclaim(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'tests/agent') as tmp:
            store = Store(tmp)
            self.addCleanup(store.close)
            store.discover('613814196', 'BV1ZZ4111111', 1, 'fixture', 'fixture', 1)
            job = store.claim('crashed-owner', lease_seconds=-1)
            store.prepare('pending-operation', {'operation': 'release.commit'})
            service = Service(store, ROOT)
            service.model = {'provider': 'fixture', 'model': 'fixture'}
            service.operator = Mock()
            service.operator.lookup.side_effect = TimeoutError('fixture: do not log secrets')
            with patch.object(store, 'claim', wraps=store.claim) as claim:
                service.process_one()
                claim.assert_not_called()
            self.assertEqual(store.jobs()[0]['lease_owner'], 'crashed-owner')
            self.assertEqual(service.last_error, 'receipt_recovery_failed')
            service.operator.lookup.side_effect = None
            service.operator.lookup.return_value = {'status': 'committed'}
            service.pi = Mock()
            service.pi.run.return_value = {'fixture': True}
            with patch.object(service, 'start_pi'):
                service.process_one()
            self.assertEqual(store.receipts()[0]['status'], 'committed')
            self.assertEqual(store.jobs()[0]['id'], job['id'])
            self.assertEqual(store.jobs()[0]['stage'], 'verifying')
            self.assertIsNone(store.jobs()[0]['lease_owner'])
