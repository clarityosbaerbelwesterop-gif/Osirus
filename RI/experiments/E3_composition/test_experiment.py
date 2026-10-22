import unittest
from agent import ComposedAgent
from environment import TwoStageWorld
from evaluate import episode,evaluate
class TestE3(unittest.TestCase):
 def test_operation_composition(self):
  a=ComposedAgent(); self.assertEqual(a.solve_stage({"a":0,"b":1}),"b")
  self.assertEqual(a.operations["verify"].uses,1)
 def test_stage_two_requires_commit(self):
  w=TwoStageWorld("a","b",1)
  self.assertEqual(w.query(2,"b"),0)
  self.assertTrue(w.commit_stage_one("a"))
  self.assertEqual(w.query(2,"b"),1)
  self.assertFalse(w.commit_stage_one("b"))
 def test_validation(self):
  w=TwoStageWorld("a","b",1)
  with self.assertRaises(ValueError): w.query(3,"a")
  with self.assertRaises(ValueError): w.commit_stage_one("x")
 def test_equal_budget_and_reproducibility(self):
  self.assertEqual(episode(4),episode(4))
  self.assertEqual(episode(4,"composed")["queries"],episode(4,"random")["queries"])
  self.assertEqual(evaluate([1,2],0)["n_seeds"],2)
if __name__=="__main__": unittest.main()
