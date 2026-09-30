"""Tournament selection rule (pre-registered Pareto score) and the CPU tournament runner."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from native import pareto  # noqa: E402  (stdlib only)

TOURNAMENT = json.loads((ROOT / "configs/native/tournament-v1.json").read_text())


def record(cand, seed, level="B", q=1.0, tasks=0.1, passkey=0.0, stored=1e8, flops=3e8, kv=1e9, tps=1e5, loss=3.0):
    return {"level": level, "candidate": cand, "seed": seed, "size": "s", "final_train_loss": loss,
            "tokens": tps * 100, "train_seconds": 100.0,
            "eval": {"val_bpb_mean": q, "tasks": {"math_synth": tasks, "algo_synth": tasks}, "passkey": {"256": passkey}},
            "spec": {"stored_bytes": stored, "flops_per_token_train": flops, "kv_bytes": {"32k": kv}}}


class TestPareto(unittest.TestCase):
    def test_quality_gate_excludes_a_cheaper_but_worse_candidate(self):
        runs = [record("A", 1, q=1.00), record("B", 1, q=1.01, kv=2e8, stored=5e7, flops=2e8, tps=2e5),
                record("C", 1, q=1.05, stored=2e7, kv=2e8, tps=2e5)]                # C: cheaper everywhere, 0.05 worse
        d = pareto.decide(TOURNAMENT, runs, "B")
        self.assertEqual(d["eligible"], ["A", "B"])
        self.assertEqual(d["winner"], "B")                     # 3x worse quality rank, better bytes/FLOPs/KV/throughput
        self.assertEqual(d["finalists"], ["A", "B", "C"])                           # C within the level-B drop margin

    def test_diverged_or_missing_runs_are_disqualified(self):
        runs = [record("A", 1), record("B", 1, loss=float("nan")), record("D", 1, level="C")]
        d = pareto.decide(TOURNAMENT, runs, "B")
        self.assertIn("B", d["disqualified"])
        self.assertNotIn("D", d["table"])
        c = pareto.decide(TOURNAMENT, [record("A", 1, level="C"), record("A", 2, level="C")], "C")
        self.assertFalse(c["complete"])                                             # seed 3 missing

    def test_level_c_uses_stability_and_scaling(self):
        runs = [record(c, s, level="C", q=q + 0.001 * s) for c, q in (("A", 1.0), ("B", 0.99)) for s in (1, 2, 3)]
        small = [record("A", 1, q=1.2), record("B", 1, q=1.25)]
        d = pareto.decide(TOURNAMENT, runs, "C", level_b_runs=small)
        self.assertIn("scaling", d["criteria"])
        self.assertIn("stability", d["criteria"])
        self.assertAlmostEqual(d["table"]["B"]["scaling"], (1.25 - 0.991) - (1.2 - 1.001), places=6)

    def test_ranks_average_ties(self):
        self.assertEqual(pareto.ranks({"a": 1, "b": 1, "c": 2}, True), {"a": 1.5, "b": 1.5, "c": 3.0})


try:
    import torch  # noqa: F401
    import tokenizers  # noqa: F401
except ImportError:
    torch = None


@unittest.skipIf(torch is None, "torch/tokenizers not installed")
class TestTournamentRunner(unittest.TestCase):
    def test_level_b_runs_every_candidate_and_resumes_nothing_twice(self):
        tmp = Path(tempfile.mkdtemp())
        subprocess.run([sys.executable, "-m", "native.data.build", "--out", str(tmp / "data"), "--tokens", "2e5",
                        "--vocab", "512", "--only", "math_synth", "algo_synth"], cwd=ROOT, check=True, capture_output=True)
        cmd = [sys.executable, "-m", "native.tournament", "run", "--tournament", "configs/native/tournament-v1.json",
               "--level", "B", "--data", str(tmp / "data"), "--out", str(tmp / "out"), "--r1-29b", "fail",
               "--tokens", "8192", "--only", "A:1,C:1",
               "--size-override", json.dumps({"vocab_size": 512, "d_model": 32, "n_layers": 3, "n_heads": 2,
                                              "n_kv_heads": 1, "max_seq": 64, "window": 16})]
        subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True)
        runs = [json.loads(l) for l in (tmp / "out/runs.jsonl").read_text().splitlines()]
        self.assertEqual(sorted(r["candidate"] for r in runs), ["A", "C"])
        self.assertEqual(next(r for r in runs if r["candidate"] == "C")["config"]["lowbit"], "int8")   # R1.29b fail
        out = subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True).stdout
        self.assertNotIn("exit", out)                                               # finished runs are not retrained


if __name__ == "__main__":
    unittest.main()
