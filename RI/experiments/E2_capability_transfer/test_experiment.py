import random
import unittest
from agent import Agent, Capability
from environment import InterventionWorld
from evaluate import episode, evaluate


class ExperimentTests(unittest.TestCase):
    def test_environment_target_outcomes(self):
        world = InterventionWorld("u", 0.0, random.Random(1))
        self.assertEqual(world.query("u"), 1)
        self.assertEqual(world.query("v"), 0)

    def test_invalid_action_and_noise(self):
        with self.assertRaises(ValueError):
            InterventionWorld("u", 0.8, random.Random(1))
        world = InterventionWorld("u", 0.0, random.Random(1))
        with self.assertRaises(ValueError):
            world.query("bad")

    def test_capability_changes_action_selection(self):
        agent = Agent(random.Random(2), use_capability=True)
        first = agent.choose_intervention()
        agent.observe(first, 0)
        second = agent.choose_intervention()
        self.assertNotEqual(first, second)

    def test_ablation_is_explicit(self):
        agent = Agent(random.Random(2), use_capability=False)
        self.assertFalse(agent.use_capability)

    def test_reproducible(self):
        self.assertEqual(episode(17), episode(17))

    def test_paired_evaluation_complete(self):
        result = evaluate([0, 1, 2], 4, 0.1)
        self.assertEqual(result["n_seeds"], 3)
        self.assertEqual(result["policies"]["capability"]["n"], 3)
        self.assertEqual(len(result["rows"]), 6)


if __name__ == "__main__":
    unittest.main()
