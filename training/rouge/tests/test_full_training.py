"""Full-parameter training (rouge_train.full) on a tiny model of the base's class.

Two ranks with FSDP2 on CPU (gloo): the run trains every language-model
weight, keeps the vision tower frozen, exports a Hugging Face checkpoint that
carries the base-only tensors, and an interrupted-and-resumed run ends on
exactly the same weights as an uninterrupted one. Needs torch and
transformers (the CI smoke job); skipped otherwise.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

HAVE_STACK = all(importlib.util.find_spec(name) for name in ("torch", "transformers", "safetensors", "tokenizers"))


@unittest.skipUnless(HAVE_STACK, "needs torch + transformers (CI smoke job)")
class FullTrainingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from rouge_train import smoke

        cls.tmp = Path(tempfile.mkdtemp(prefix="rouge-full-"))
        cls.base = cls.tmp / "base"
        tokenizer = smoke.tiny_tokenizer(cls.base)
        smoke.tiny_model(tokenizer, cls.base, seed=3)
        train, _ = smoke.smoke_data(cls.tmp)
        with train.open("a") as handle:                          # plain-text records train every token
            for i in range(8):
                handle.write(json.dumps({"id": f"x{i}", "source": "replay", "text": f"Rouge answers in German and English {i}."}) + "\n")
        cls.train_file = train

    def config(self, name: str, **changes) -> Path:
        body = {
            "name": "rouge-1-sft-001", "mode": "full", "base_path": str(self.base), "tokenizer_path": str(self.base),
            "train_file": str(self.train_file), "output_dir": str(self.tmp / name), "dtype": "float32",
            "gradient_checkpointing": True, "max_seq_len": 256, "micro_batch_size": 1, "grad_accum": 2,
            "learning_rate": 3e-3, "warmup_ratio": 0.0, "max_steps": 6, "save_every": 3, "log_every": 1,
            "loss_chunk_tokens": 16, "keep_checkpoints": 1,
        }
        body.update(changes)
        path = self.tmp / f"{name}-{len(changes)}.json"
        path.write_text(json.dumps(body))
        return path

    def launch(self, config: Path, nproc: int) -> subprocess.CompletedProcess:
        env = dict(os.environ, OMP_NUM_THREADS="1", PYTHONHASHSEED="0")
        if nproc == 1:
            command = [sys.executable, "-m", "rouge_train.cli", "train", "--config", str(config)]
        else:
            command = [sys.executable, "-m", "torch.distributed.run", "--standalone", f"--nproc-per-node={nproc}",
                       "-m", "rouge_train.cli", "train", "--config", str(config)]
        return subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=900)

    def test_two_ranks_train_export_and_resume_exactly(self):
        from rouge_train.merge import weight_delta

        straight = self.launch(self.config("straight"), 2)
        self.assertEqual(straight.returncode, 0, straight.stderr[-3000:])
        report = json.loads((self.tmp / "straight" / "train-report.json").read_text())
        self.assertEqual(report["world"], 2)
        self.assertEqual(report["steps"], 6)
        self.assertLess(report["final_loss"], report["first_loss"])
        self.assertIn("mtp.smoke_marker", report["carried_from_base"])

        delta = weight_delta(self.base, self.tmp / "straight" / "model")
        self.assertGreater(delta["changed"], 0)
        self.assertEqual(delta["only_in_candidate"], [])
        changed = set()
        for key in delta["changed_examples"]:
            changed.add(key.split(".")[1] if key.startswith("model.") else key.split(".")[0])
        self.assertNotIn("visual", changed)                        # the vision tower is frozen

        first = self.launch(self.config("resumed", stop_after=3), 2)
        self.assertTrue((self.tmp / "resumed" / "checkpoints" / "step-000003").is_dir(), first.stderr[-3000:])
        second = self.launch(self.config("resumed"), 2)
        self.assertEqual(second.returncode, 0, second.stderr[-3000:])
        resumed = json.loads((self.tmp / "resumed" / "train-report.json").read_text())
        self.assertEqual(resumed["resumed_from"], "step-000003")
        self.assertEqual(resumed["losses"], report["losses"][3:] if len(resumed["losses"]) == 3 else report["losses"])
        same = weight_delta(self.tmp / "straight" / "model", self.tmp / "resumed" / "model")
        self.assertEqual(same["changed"], 0, same["changed_examples"])

    def test_one_process_runs_the_same_path(self):
        run = self.launch(self.config("single", max_steps=2), 1)
        self.assertEqual(run.returncode, 0, run.stderr[-3000:])
        report = json.loads((self.tmp / "single" / "train-report.json").read_text())
        self.assertEqual(report["world"], 1)
        self.assertTrue((self.tmp / "single" / "model" / "config.json").exists())

    def test_config_refuses_quantised_full_training(self):
        from rouge_train.config import RunConfig

        with self.assertRaises(ValueError):
            RunConfig.load(self.config("bad", quantization="4bit"))


if __name__ == "__main__":
    unittest.main()
