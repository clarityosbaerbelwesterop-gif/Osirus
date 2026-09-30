"""Post-training stages on a tiny model (CPU): masking, SFT, DPO, rejection sampling, GRPO guard."""

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import torch
    from tokenizers import Tokenizer

    from native import RougeConfig, RougeModel, checkpoint, posttrain
except ImportError:
    torch = None


@unittest.skipIf(torch is None, "torch/tokenizers not installed")
class TestPosttrain(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        subprocess.run([sys.executable, "-m", "native.data.build", "--out", str(cls.tmp / "data"), "--tokens", "2e5",
                        "--vocab", "600", "--only", "math_synth", "algo_synth"], cwd=ROOT, check=True, capture_output=True)
        cls.tok = Tokenizer.from_file(str(cls.tmp / "data/tokenizer.json"))
        torch.manual_seed(0)
        cls.cfg = RougeConfig(vocab_size=cls.tok.get_vocab_size(), d_model=32, n_layers=2, n_heads=2, n_kv_heads=2, max_seq=128)

    def model(self):
        torch.manual_seed(0)
        return RougeModel(self.cfg)

    def test_loss_mask_covers_assistant_only(self):
        ids, mask = posttrain.encode_chat(self.tok, [{"role": "user", "content": "Q: 2 + 2 ="}, {"role": "assistant", "content": "4"}])
        self.assertEqual(len(ids), len(mask))
        eos = self.tok.token_to_id("<|eos|>")
        user_part = ids[:ids.index(eos) + 1]
        self.assertEqual(sum(mask[:len(user_part)]), 0)                         # nothing learned from the user turn
        self.assertGreater(sum(mask), 0)
        ids_r, mask_r = posttrain.encode_chat(self.tok, [{"role": "user", "content": "x"}, {"role": "assistant", "content": "y"}],
                                              reasoning="because")
        self.assertIn(self.tok.token_to_id("<|think|>"), ids_r)
        self.assertGreater(sum(mask_r), sum(posttrain.encode_chat(self.tok, [{"role": "user", "content": "x"},
                                                                              {"role": "assistant", "content": "y"}])[1]))

    def test_sft_learns_the_assistant_answer(self):
        m = self.model()
        opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
        recs = [{"messages": [{"role": "user", "content": "Q: 7 + 5 ="}, {"role": "assistant", "content": "12"}]}] * 4
        first = posttrain.sft_step(m, opt, self.tok, recs, torch.device("cpu"))
        for _ in range(40):
            last = posttrain.sft_step(m, opt, self.tok, recs, torch.device("cpu"))
        self.assertLess(last, first * 0.3)

    def test_dpo_prefers_chosen(self):
        m = self.model()
        ref = copy.deepcopy(m).eval()
        opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
        pairs = [{"prompt": "Q: 3 * 4 =", "chosen": " 12", "rejected": " 13"}]
        dev = torch.device("cpu")
        margin = lambda: (posttrain.sequence_logprob(m, self.tok.encode(pairs[0]["prompt"]).ids, self.tok.encode(" 12").ids, dev)
                          - posttrain.sequence_logprob(m, self.tok.encode(pairs[0]["prompt"]).ids, self.tok.encode(" 13").ids, dev)).item()
        before = margin()
        for _ in range(30):
            posttrain.dpo_step(m, ref, opt, self.tok, pairs, dev)
        self.assertGreater(margin(), before + 1.0)

    def test_verifier_and_rejection_sampling(self):
        self.assertTrue(posttrain.verify_answer(" 12 and more", "12"))
        self.assertFalse(posttrain.verify_answer(" 13", "12"))
        self.assertTrue(posttrain.verify_answer(" 3/4", "3/4"))
        kept = posttrain.rejection_sample(self.model(), self.tok, [{"prompt": "Q: 1 + 1 =", "answer": "2"}], k=2,
                                          device=torch.device("cpu"))
        self.assertTrue(all(r["verified"] for r in kept))                      # only verified answers survive

    def test_grpo_refuses_a_base_model(self):
        m = self.model()
        run = self.tmp / "base"
        opt = torch.optim.AdamW(m.parameters())
        checkpoint.save(run, 1, m, opt, {"architecture_sha": self.cfg.architecture_sha, "config": json.loads(self.cfg.to_json())})
        data = self.tmp / "rl.jsonl"
        data.write_text(json.dumps({"prompt": "Q: 1 + 1 =", "answer": "2"}) + "\n")
        out = subprocess.run([sys.executable, "-m", "native.posttrain", "grpo", "--init", str(run), "--data", str(data),
                              "--tokenizer", str(self.tmp / "data/tokenizer.json"), "--out", str(self.tmp / "rl"), "--steps", "1"],
                             cwd=ROOT, capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("needs an SFT checkpoint", out.stderr + out.stdout)
        # the same step runs from an SFT checkpoint
        checkpoint.save(self.tmp / "sft", 1, m, opt, {"architecture_sha": self.cfg.architecture_sha,
                                                      "config": json.loads(self.cfg.to_json()), "stage": "sft"})
        ok = subprocess.run([sys.executable, "-m", "native.posttrain", "grpo", "--init", str(self.tmp / "sft"), "--data", str(data),
                             "--tokenizer", str(self.tmp / "data/tokenizer.json"), "--out", str(self.tmp / "rl2"), "--steps", "2",
                             "--batch", "1"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stderr[-800:])
        self.assertEqual(checkpoint.latest(self.tmp / "rl2")[1]["stage"], "grpo")


if __name__ == "__main__":
    unittest.main()
