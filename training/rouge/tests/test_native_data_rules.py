"""Corpus decontamination rules (numpy only; no network)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    from native.data import build
except ImportError:  # the stdlib-only unit job has no numpy
    build = None

BOILER = "Licensed under the Apache License Version 2 0 you may not use this file except in compliance with the License"
UNIQUE = "the hidden evaluation answer about seventeen purple giraffes crossing a frozen river at dawn is forty two"


@unittest.skipIf(build is None, "numpy not installed")
class TestDecontaminationRules(unittest.TestCase):
    def corpus(self):
        val = [(f"v{i}", f"{BOILER}. document {i} body text", "MIT") for i in range(3)] + [("u", UNIQUE, "MIT")]
        return {"code_py": {"val": val}}

    def test_v2_ignores_boilerplate_shared_by_three_eval_texts(self):
        v1, v2 = build.eval_grams(self.corpus(), "v1"), build.eval_grams(self.corpus(), "v2")
        boiler, unique = build.ngrams13(BOILER), build.ngrams13(UNIQUE)
        self.assertTrue(boiler <= v1 and unique <= v1)
        self.assertFalse(boiler & v2)
        self.assertTrue(unique <= v2)

    def test_a_train_document_with_eval_content_is_still_dropped(self):
        build._EVAL_GRAMS = build.eval_grams(self.corpus(), "v2")
        self.assertFalse(build._contaminated(f"{BOILER}. def main(): return 1"))
        self.assertTrue(build._contaminated(f"notes: {UNIQUE} and more"))

    def test_unknown_rule_is_refused(self):
        with self.assertRaises(ValueError):
            build.eval_grams(self.corpus(), "v9")


if __name__ == "__main__":
    unittest.main()
