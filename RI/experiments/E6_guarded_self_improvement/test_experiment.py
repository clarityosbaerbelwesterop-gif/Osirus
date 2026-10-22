import unittest
from agent import PolicyConfig,propose
from evaluate import run
class TestE6(unittest.TestCase):
 def test_bounds(self):
  with self.assertRaises(ValueError):PolicyConfig(2,.5).validate()
 def test_allowlisted_proposal(self):
  c=propose(PolicyConfig(),"retention");self.assertEqual(c.memory_weight,.6)
 def test_deterministic_eval(self):
  self.assertEqual(run([1,2]),run([1,2]))
if __name__=="__main__":unittest.main()
