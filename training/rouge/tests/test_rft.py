"""RSI data selection (rouge_train.rft): only verified-correct answers of informative prompts."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rouge_train import rft  # noqa: E402


def prompt(pid: str, answer: float) -> dict:
    return {"id": pid, "source": "openr1-math", "category": "math",
            "messages": [{"role": "user", "content": f"Problem {pid}\n\nEnd with a line \"Answer: <number>\"."}],
            "check": {"type": "numeric", "answer": answer}}


class RftSelectTest(unittest.TestCase):
    def test_keeps_only_verified_answers_of_prompts_the_model_sometimes_misses(self):
        prompts = [prompt("a", 12), prompt("b", 7), prompt("c", 3)]
        samples = {
            "a": ["reasoning</think>\nAnswer: 12", "reasoning</think>\nAnswer: 13", "x</think>\nAnswer: 12", "Answer: 11"],
            "b": ["Answer: 1", "Answer: 2", "Answer: 3", "Answer: 4"],
            "c": ["Answer: 3"] * 4,
        }
        records, stats = rft.select(prompts, samples, max_per_prompt=2, easy_fraction=0.0)
        self.assertEqual(stats["buckets"], {"sometimes": 1, "never": 1, "always": 1})
        self.assertEqual([r["id"] for r in records], ["rft-a-0", "rft-a-1"])
        for record in records:
            answer = record["messages"][-1]["content"]
            self.assertTrue(answer.startswith("<think>\n"))          # the opened thinking block is restored
            self.assertTrue(answer.rstrip().endswith("Answer: 12"))
        self.assertAlmostEqual(stats["sample_accuracy"], 6 / 12)

    def test_easy_prompts_contribute_one_answer_by_a_fixed_hash(self):
        prompts = [prompt(f"p{i}", 1) for i in range(200)]
        samples = {p["id"]: ["Answer: 1"] * 4 for p in prompts}
        records, _ = rft.select(prompts, samples, easy_fraction=0.25)
        again, _ = rft.select(prompts, samples, easy_fraction=0.25)
        self.assertEqual(records, again)
        self.assertTrue(20 < len(records) < 80)
        self.assertEqual(len({r["id"].rsplit("-", 1)[0] for r in records}), len(records))


if __name__ == "__main__":
    unittest.main()


class Rouge1PreflightTest(unittest.TestCase):
    def test_launcher_refuses_a_draft_pre_registration_and_single_gpu_machines(self):
        import argparse
        import json

        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lightning_ai"))
        import rouge1_session

        args = argparse.Namespace(run="rouge-1-rl-001", prereg="experiments/rouge-1-rl-001.json", machine="H200_X_8",
                                  max_hours=2.5, parent_ref="")
        prereg = json.loads((Path(__file__).resolve().parents[1] / args.prereg).read_text())
        if prereg["status"] != "pre-registered":
            with self.assertRaises(SystemExit):
                rouge1_session.preflight(args)
        import cost

        self.assertEqual(cost.gpus("H200_X_8"), ("H200", 8))
        self.assertLess(cost.worst_case("H200_X_8", 2.5, 36.0), cost.CEILING_USD)
