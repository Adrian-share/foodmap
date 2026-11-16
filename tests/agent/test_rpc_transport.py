import json
import queue
import unittest
from unittest.mock import Mock
from foodmap_agent.pi_rpc import PiRPC, ProtocolError

class Transport(unittest.TestCase):
    def rpc(self, messages):
        rpc=PiRPC.__new__(PiRPC)
        rpc.proc=Mock()
        rpc.messages=queue.Queue()
        for message in messages:rpc.messages.put(message)
        rpc.events=[]
        rpc.on_poll=None
        return rpc

    def test_request_ids_are_checked_and_events_preserved(self):
        rpc=self.rpc([{'type':'agent_end'},{'type':'response','id':'foreign','success':True}])
        with self.assertRaises(ProtocolError):rpc.request('get_state',timeout=.1)
        self.assertEqual(rpc.events,[{'type':'agent_end'}])

    def test_missing_settled_times_out_even_after_agent_end(self):
        from foodmap_agent.pi_rpc import RunTracker
        tracker=RunTracker('task','generation','session');tracker.accept({'disposition':'started'})
        tracker.event({'type':'agent_end'})
        rpc=self.rpc([])
        with self.assertRaises(TimeoutError):rpc._next(__import__('time').monotonic()+.01)
        self.assertFalse(tracker.done)

    def test_aborted_settlement_never_completes(self):
        from foodmap_agent.pi_rpc import RunTracker
        tracker=RunTracker('task','g','s');tracker.accept({'disposition':'started'})
        with self.assertRaises(ProtocolError):tracker.event({'type':'agent_settled','aborted':True})
        self.assertFalse(tracker.done)

    def test_model_error_settles_as_blocked_model(self):
        from foodmap_agent.pi_rpc import RunTracker
        tracker=RunTracker('task','g','s');tracker.accept({'disposition':'started'})
        tracker.event({'type':'message_end','message':{'role':'assistant','stopReason':'error'}})
        with self.assertRaisesRegex(ProtocolError,'blocked_model'):tracker.event({'type':'agent_settled','aborted':False})
        self.assertFalse(tracker.done)
