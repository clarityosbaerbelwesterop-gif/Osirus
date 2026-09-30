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
        else:                                                     # the committed pin, pre-registration, dataset and config agree
            self.assertEqual(rouge1_session.preflight(args)["name"], "rouge-1-rl-001")
        import cost

        self.assertEqual(cost.gpus("H200_X_8"), ("H200", 8))
        self.assertLess(cost.worst_case("H200_X_8", 2.5, 36.0), cost.CEILING_USD)


class InstallFitTest(unittest.TestCase):
    def test_q4_k_m_fits_a_32_gb_mac_but_not_24_gb_or_an_ipad(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "serve"))
        import install

        q4 = int(16.8 * 2**30)
        self.assertTrue(install.fits(q4, 32 * 2**30, "Darwin"))
        self.assertFalse(install.fits(q4, 24 * 2**30, "Darwin"))
        self.assertFalse(install.fits(q4, 16 * 2**30, "Darwin"))
        self.assertTrue(install.fits(q4, None, "Darwin"))


class TeacherTest(unittest.TestCase):
    def test_hard_prompts_are_those_the_model_never_solved(self):
        prompts = [prompt("a", 1), prompt("b", 2)]
        samples = {"a": ["Answer: 1", "Answer: 0"], "b": ["Answer: 0", "Answer: 3"]}
        self.assertEqual([p["id"] for p in rft.hard_prompts(prompts, samples)], ["b"])
        self.assertEqual([p["id"] for p in rft.hard_prompts(prompts, samples, 0.5)], ["a", "b"])
        records, _ = rft.select(prompts, samples, easy_fraction=1.0, source_prefix="teacher-deepseek-v4-pro")
        self.assertEqual([r["source"] for r in records], ["teacher-deepseek-v4-pro-openr1-math"])

    def test_teacher_pin_accepts_mit_text_and_refuses_other_licences(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
        import pin_base

        raw = {"repo": "deepseek-ai/DeepSeek-V4-Pro", "revision": "b" * 40, "gated": False, "private": False,
               "license": {"cardLicense": "mit", "licenseFileSha256": "c" * 64,
                           "licenseHead": "MIT License\n\nPermission is hereby granted, free of charge"},
               "weights": {"shards": 1, "bytes": 10, "allHashed": True}, "files": [], "config": {}}
        pinned = pin_base.pin_teacher(raw, run_id="1", decision="d", today="2026-09-30")
        self.assertEqual(pinned["license"]["spdx"], "MIT")
        for bad in ({"cardLicense": "other", "licenseHead": ""}, {"cardLicense": "mit", "licenseHead": "DeepSeek License Agreement"}):
            with self.assertRaises(SystemExit):
                pin_base.pin_teacher(dict(raw, license=bad), run_id="1", decision="d", today="t")

    def test_teacher_job_needs_eight_b200(self):
        import argparse

        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lightning_ai"))
        import rouge1_session

        teacher = Path(__file__).resolve().parents[3] / "models" / "teachers" / "deepseek-v4-pro.json"
        if not teacher.exists():
            self.skipTest("teacher not pinned yet")
        args = argparse.Namespace(teacher="models/teachers/deepseek-v4-pro.json", machine="H200_X_8", run="rouge-1-rl-001", max_hours=1.5)
        with self.assertRaises(SystemExit):
            rouge1_session.teacher_preflight(args)
        args.machine = "B200_X_8"
        self.assertEqual(rouge1_session.teacher_preflight(args)["license"]["spdx"], "MIT")
