import random
import unittest

from agent import Agent
from environment import InterventionWorld


class EnvironmentTests(unittest.TestCase):
    def test_deterministic_correct_feature(self):
        world = InterventionWorld("u", 0.0, random.Random(1))
        self.assertEqual(world.query("u"), 1)
        self.assertEqual(world.query("v"), 0)

    def test_invalid_action_rejected(self):
        world = InterventionWorld("u", 0.0, random.Random(1))
        with self.assertRaises(ValueError):
            world.query("unknown")

    def test_invalid_noise_rejected(self):
        with self.assertRaises(ValueError):
            InterventionWorld("u", 0.8, random.Random(1))

    def test_agent_exports_auditable_evidence(self):
        agent = Agent(random.Random(3))
        agent.observe("u", 1)
        cap = agent.export_capability()
        self.assertEqual(cap.name, "controlled_comparison")
        self.assertEqual(cap.evidence, [("u", 1)])
        self.assertFalse(cap.verified)


if __name__ == "__main__":
    unittest.main()
