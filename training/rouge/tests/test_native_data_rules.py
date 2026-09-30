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

    def test_v3_drops_a_copy_of_a_validation_document_but_not_a_shared_idiom(self):
        val_doc = " ".join(f"word{i}" for i in range(200))            # 188 grams, all specific to this document
        corpus = {"web_en": {"val": [("d", val_doc, "ODC")]}}
        build._RULE = "v3"
        build._ITEM_GRAMS, build._DOC_INDEX, build._DOC_NEED = build.copy_index(corpus)
        self.assertEqual(build._DOC_NEED, [build.COPY_GRAMS])
        idiom = " ".join(f"word{i}" for i in range(20))                # 8 shared grams: an idiom, not a copy
        copy = "intro " * 300 + val_doc + " outro" * 300                # the whole document inside a long page
        self.assertFalse(build._contaminated(f"unrelated text {idiom} more unrelated text"))
        self.assertTrue(build._contaminated(copy))
        build._RULE = "v1"

    def test_v3_drops_any_eval_item_content(self):
        build._RULE, build._DOC_INDEX, build._DOC_NEED = "v3", {}, []
        build._ITEM_GRAMS = build.ngrams13(UNIQUE)
        self.assertTrue(build._contaminated(f"notes: {UNIQUE}"))
        self.assertFalse(build._contaminated(BOILER))
        build._RULE = "v1"


@unittest.skipIf(build is None, "numpy not installed")
class TestEpochs(unittest.TestCase):
    class Tok:
        def get_vocab_size(self):
            return 100

        def token_to_id(self, token):
            return 2

        def encode_batch(self, texts):
            return [type("E", (), {"ids": [5] * 9})() for _ in texts]   # 10 tokens per document with EOS

    def test_code_repeats_up_to_its_epoch_limit(self):
        import tempfile

        corpus = {"code_py": {"train": [("a", "x", "MIT")] * 30, "val": []}}   # 300 unique tokens
        for epochs, budget, expect in ((2, 1000, 600), (2, 450, 450), (1, 1000, 300)):
            out = Path(tempfile.mkdtemp())
            shards = build.write_shards(corpus, self.Tok(), out, budget, {"code_py": 1.0}, {"code_py": epochs})
            train = shards["code_py"]["train"]
            self.assertEqual(train["tokens"], expect)
            if epochs > 1:
                self.assertEqual(train["tokens_unique"], 300)
                self.assertAlmostEqual(train["epochs"], expect / 300, places=3)
            else:
                self.assertNotIn("epochs", train)


if __name__ == "__main__":
    unittest.main()
