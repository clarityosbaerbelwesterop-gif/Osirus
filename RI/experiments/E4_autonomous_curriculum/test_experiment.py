import unittest
from agent import CurriculumAgent
from environment import CurriculumWorld
from evaluate import episode,evaluate
class TestE4(unittest.TestCase):
 def test_selection_and_update(self):
  a=CurriculumAgent(); self.assertIn(a.choose_task(),a.families); a.update("causal",1)
  self.assertEqual(a.total["causal"],1)
 def test_environment_validation(self):
  with self.assertRaises(ValueError): CurriculumWorld(1,.8)
  with self.assertRaises(ValueError): CurriculumWorld(1).attempt("unknown",0)
 def test_reproducibility(self):
  self.assertEqual(episode(2,"fixed",10),episode(2,"fixed",10))
  self.assertIn("random",evaluate([1,2],10,.1)["policies"])
if __name__=="__main__":unittest.main()
