import unittest
from agent import ComposedAgent
from environment import TwoStageWorld
from evaluate import episode,evaluate
class TestE3(unittest.TestCase):
 def test_composition(self):
  a=ComposedAgent(); self.assertEqual(a.solve_stage({"a":0,"b":1}),"b")
  self.assertEqual(a.operations["verify"].uses,1)
 def test_validation(self):
  w=TwoStageWorld("a","b",1); self.assertEqual(w.query(1,"a"),1)
  with self.assertRaises(ValueError): w.query(3,"a")
 def test_reproducibility(self):
  self.assertEqual(episode(4),episode(4)); self.assertEqual(evaluate([1,2],0)["n_seeds"],2)
if __name__=="__main__": unittest.main()
