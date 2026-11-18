"""Guard tests only; never send signals or claim a production P3 pass."""
import unittest
from foodmap_agent.p3_acceptance import fault_ready
class P3ObserverGuards(unittest.TestCase):
 def test_only_first_attempt_then_same_second_attempt_with_future_budget_are_eligible(self):
  good=dict(stage='cleaning',attempt=1,lease_owner='owner',lease_until=200)
  s=dict(instance_id='owner',scheduler_owner='python',mode='production')
  self.assertTrue(fault_ready(good,s,1,True,100,False))
  self.assertFalse(fault_ready({**good,'attempt':2},s,1,True,100,False))
  self.assertTrue(fault_ready({**good,'attempt':2},s,8,True,100,True))
  for job,used,registered in [({**good,'attempt':3},8,True),({**good,'attempt':2},10,True),({**good,'attempt':2},8,False),({**good,'attempt':2,'lease_owner':'other'},8,True)]:
   self.assertFalse(fault_ready(job,s,used,registered,100,True))
