import random, unittest
from agent import Agent
from environment import InterventionWorld
from evaluate import episode, evaluate

class ExperimentTests(unittest.TestCase):
    def test_environment_target_outcomes(self):
        world=InterventionWorld("u",0.0,random.Random(1))
        self.assertEqual(world.query("u"),1); self.assertEqual(world.query("v"),0)
    def test_invalid_inputs(self):
        with self.assertRaises(ValueError): InterventionWorld("u",.8,random.Random(1))
        with self.assertRaises(ValueError): InterventionWorld("u",0,random.Random(1)).query("bad")
    def test_capability_changes_action_selection(self):
        a=Agent(random.Random(2),use_capability=True); first=a.choose_intervention()
        a.observe(first,0); self.assertNotEqual(first,a.choose_intervention())
    def test_reproducible_and_paired(self):
        self.assertEqual(episode(17),episode(17))
        result=evaluate([0,1,2],4,.1)
        self.assertEqual(result["n_seeds"],3); self.assertEqual(len(result["rows"]),9)
        self.assertIn("fixed",result["policies"])
if __name__=="__main__": unittest.main()
