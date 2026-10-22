import unittest
from agent import ContinualAgent
from evaluate import episode,evaluate
class TestE5(unittest.TestCase):
 def test_bayesian_update(self):
  a=ContinualAgent(); self.assertEqual(a.predict("x"),.5); a.observe("x",1); self.assertGreater(a.predict("x"),.5)
 def test_validation(self):
  with self.assertRaises(ValueError): ContinualAgent().observe("x",2)
 def test_retention(self):
  a=ContinualAgent();a.observe("causal",1);a.observe("spatial",0);self.assertGreater(a.predict("causal"),.5)
 def test_reproducibility(self):
  self.assertEqual(episode(4),episode(4));self.assertIn("persistent",evaluate([1,2],10)["policies"])
if __name__=="__main__":unittest.main()
