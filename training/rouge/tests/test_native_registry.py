"""Model registry hash chain, ladder shapes and the architecture freeze."""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from native import registry  # noqa: E402  (stdlib only)
from native.config import RougeConfig  # noqa: E402


def entry(name, parent=None):
    return {"name": name, "parent": parent, "code_sha": "c", "architecture_sha": "a", "data_sha": "d", "tokenizer_sha": "t",
            "optimizer": {"name": "adamw"}, "schedule": {"name": "wsd"}, "hardware": "1x H200", "tokens": 1,
            "train_flops": 1.0, "final_loss": 2.0, "evals": {}, "checkpoint_sha": "k"}


class TestRegistry(unittest.TestCase):
    def test_chain_detects_edits_and_removals(self):
        reg = {"schema": "rouge.registry/1", "entries": []}
        registry.append(reg, entry("rouge-r1-100m-001"), path=None)
        registry.append(reg, entry(registry.next_name(reg, "100m"), parent="rouge-r1-100m-001"), path=None)
        self.assertEqual(reg["entries"][1]["name"], "rouge-r1-100m-002")
        self.assertEqual(registry.verify(reg), [])
        edited = copy.deepcopy(reg)
        edited["entries"][0]["final_loss"] = 1.0
        self.assertTrue(registry.verify(edited))
        removed = copy.deepcopy(reg)
        del removed["entries"][0]
        self.assertTrue(registry.verify(removed))

    def test_rejects_bad_names_duplicates_and_unknown_parents(self):
        reg = {"schema": "rouge.registry/1", "entries": []}
        with self.assertRaises(ValueError):
            registry.append(reg, entry("rouge-100m"), path=None)
        registry.append(reg, entry("rouge-r1-100m-001"), path=None)
        with self.assertRaises(ValueError):
            registry.append(reg, entry("rouge-r1-100m-001"), path=None)
        reg2 = copy.deepcopy(reg)
        reg2["entries"].append({**entry("rouge-r1-300m-001", parent="rouge-r1-1b-009")})
        self.assertTrue(any("parent" in p for p in registry.verify(reg2)))


class TestLadder(unittest.TestCase):
    def test_rung_sizes(self):
        try:
            from native import spec
        except ImportError:
            self.skipTest("spec needs the native package")
        ladder = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())
        expect = {"100m": 100e6, "300m": 300e6, "1b": 1.0e9, "600m": 0.55e9, "2b-moe": 2.1e9}
        for rung, r in ladder["rungs"].items():
            cfg = RougeConfig(**{**ladder["common"], **r["shape"], **r.get("fixed", {})})
            params = spec.summary(cfg)["params_physical"]
            self.assertAlmostEqual(params / expect[rung], 1.0, delta=0.1, msg=f"{rung}: {params / 1e6:.0f}M")

    def test_freeze_needs_a_complete_level_c_decision(self):
        from native import freeze

        t = json.loads((ROOT / "configs/native/tournament-v1.json").read_text())
        ladder = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())
        with self.assertRaises(SystemExit):
            freeze.configs({"complete": True, "level": "B", "winner": "B"}, t, ladder, "pass")
        cfgs = freeze.configs({"complete": True, "level": "C", "winner": "D"}, t, ladder, "fail")
        self.assertEqual(cfgs["100m"].lowbit, "int8")
        self.assertEqual(cfgs["100m"].moe_experts, 8)
        self.assertEqual(cfgs["300m"].d_model, 1024)
        self.assertEqual(len(freeze.describe(cfgs["100m"])), 15)          # every component of the freeze gate


if __name__ == "__main__":
    unittest.main()
