"""Controlled recursive improvement: allowlist, control plane, blind decision rules."""

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from native import cri  # noqa: E402  (stdlib only at import)

SOURCES = ["web_en", "web_de", "code_py", "math_web", "math_synth", "algo_synth"]


def m(q, domains=None, tasks=0.5):
    domains = domains or {"web_en": q, "code_py": q}
    return {"val_bpb_mean": q, "val": {k: {"bpb": v} for k, v in domains.items()}, "tasks": {"math_synth": tasks}}


class TestCRI(unittest.TestCase):
    def test_allowlist_rejects_architecture_and_out_of_bounds_changes(self):
        base = {"id": "x", "weakness": "w", "hypothesis": "h", "falsifier": "f"}
        self.assertEqual(cri.validate({**base, "change": {"training": {"lr": 2e-3, "schedule": "cosine"}}}, SOURCES), [])
        self.assertTrue(cri.validate({**base, "change": {"architecture": {"n_layers": 48}}}, SOURCES))
        self.assertTrue(cri.validate({**base, "change": {"training": {"lr": 1.0}}}, SOURCES))
        self.assertTrue(cri.validate({**base, "change": {"training": {"eval_windows": 1}}}, SOURCES))
        self.assertTrue(cri.validate({**base, "change": {"mixture": {"web_en": 0.9, "web_de": 0.1}}}, SOURCES))
        self.assertTrue(cri.validate({**base, "change": {"mixture": {"benchmark_answers": 1.0}}}, SOURCES))
        self.assertTrue(cri.validate({"change": {}}, SOURCES))                  # missing hypothesis and falsifier

    def test_control_plane_detects_a_changed_file(self):
        pinned = {f: cri.sha256(cri.REPO / f) for f in cri.CONTROL_PLANE}
        with mock.patch.object(cri, "PIN") as pin:
            pin.exists.return_value = True
            pin.read_text.return_value = json.dumps({"files": pinned})
            self.assertEqual(cri.verify_control_plane(), [])
            pin.read_text.return_value = json.dumps({"files": {**pinned, "training/rouge/native/evaluate.py": "0" * 64}})
            self.assertEqual(len(cri.verify_control_plane()), 1)

    def test_promotion_needs_margin_and_no_regression(self):
        labels = cri.blind_labels(["c1", "c2", "c3"], ["h1", "h2", "h3"], seed=1)
        self.assertEqual(sorted(v["role"] for v in labels.values()), ["challenger"] * 3 + ["champion"] * 3)
        def metrics(champ, chall):
            return {k: (champ if v["role"] == "champion" else chall) for k, v in labels.items()}
        self.assertEqual(cri.decide(metrics(m(1.00), m(0.98)), labels, "C")["decision"], "promote")
        self.assertEqual(cri.decide(metrics(m(1.00), m(0.995)), labels, "C")["decision"], "reject")        # below margin
        regress = m(0.98, {"web_en": 0.90, "code_py": 1.06})                                             # one domain worse
        self.assertEqual(cri.decide(metrics(m(1.00), regress), labels, "C")["decision"], "reject")
        self.assertEqual(cri.decide(metrics(m(1.00), m(0.98, tasks=0.4)), labels, "C")["decision"], "reject")
        self.assertEqual(cri.decide(metrics(m(1.00), None), labels, "C")["decision"], "reject")
        one = cri.blind_labels(["c1"], ["h1"], seed=0)
        self.assertEqual(cri.decide({k: m(1.0) for k in one}, one, "C")["decision"], "void")              # needs 3 seeds

    def test_proposal_targets_the_weakest_domain_within_bounds(self):
        champion = {"eval": {"val": {"web_en": {"bpb": 1.0}, "code_py": {"bpb": 0.8}, "math_web": {"bpb": 1.4}}}}
        mixture = {"web_en": 0.55, "web_de": 0.15, "code_py": 0.12, "math_web": 0.08, "math_synth": 0.05, "algo_synth": 0.05}
        p = cri.propose(champion, mixture)
        self.assertEqual(p["weakness"], "math_web")
        self.assertEqual(cri.validate(p, SOURCES), [])
        self.assertGreater(p["change"]["mixture"]["math_web"], mixture["math_web"])


if __name__ == "__main__":
    unittest.main()
