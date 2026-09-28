"""Pipeline tests: data masking, checkers, config. Need transformers/torch;
skipped in the stdlib-only job and run in the smoke job."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

HAS_STACK = all(importlib.util.find_spec(m) for m in ("torch", "transformers", "tokenizers"))

from rouge_train import evaluate  # noqa: E402
from rouge_train.config import RunConfig  # noqa: E402


class CheckerTest(unittest.TestCase):
    def test_checks_are_code_not_judgement(self):
        self.assertTrue(evaluate.check({"type": "numeric", "answer": 391}, "<think>17*23</think>So... Answer: 391"))
        self.assertFalse(evaluate.check({"type": "numeric", "answer": 391}, "Answer: 392"))
        self.assertTrue(evaluate.check({"type": "json_keys", "keys": ["a", "b"]}, '```json\n{"a": 1, "b": 2}\n```'))
        self.assertTrue(evaluate.check({"type": "bullets", "n": 3}, "- a\n- b\n- c"))
        self.assertTrue(evaluate.check({"type": "language", "lang": "de"}, "Das ist eine gute Antwort, und sie ist für dich."))
        self.assertTrue(evaluate.check({"type": "all", "checks": [{"type": "no_commas"}, {"type": "ends_with", "text": "Ende."}]}, "Kurz und klar. Ende."))
        code = "```python\ndef add(a, b):\n    return a + b\n```"
        self.assertTrue(evaluate.check({"type": "python_tests", "tests": "assert add(2, 3) == 5"}, code))
        self.assertFalse(evaluate.check({"type": "python_tests", "tests": "assert add(2, 3) == 6"}, code))
        self.assertFalse(evaluate.check({"type": "python_tests", "tests": "assert True", "timeout": 1}, "```python\nwhile True: pass\n```"))

    def test_comparison_reports_regressions(self):
        items = [{"id": str(i), "category": "c"} for i in range(4)]
        result = evaluate.compare(items, [True, True, False, False], [True, False, True, True])
        self.assertEqual(result["overall"]["wins"], 2)
        self.assertEqual(result["overall"]["regressions"], 1)
        self.assertEqual(result["overall"]["regressed_ids"], ["1"])


    def test_numbers_in_english_and_german_notation(self):
        for text, value in [("Answer: 3,600", 3600), ("Antwort: 3.600 Sekunden", 3600), ("Antwort: 2,5", 2.5), ("Answer: 2.5", 2.5)]:
            self.assertTrue(evaluate.check({"type": "numeric", "answer": value}, text), text)

    def test_preregistered_verdict(self):
        rule = {"alpha": 0.05, "guard_max_drop": 0.05}
        items = [{"id": f"p{i}", "category": "missing-info", "suite": "primary"} for i in range(40)]
        items += [{"id": f"g{i}", "category": "coding", "suite": "guard"} for i in range(40)]
        base = [False] * 40 + [True] * 40
        better = [True] * 30 + [False] * 10 + [True] * 40
        self.assertEqual(evaluate.verdict(items, base, better, rule)["result"], "PASS")
        # A primary gain does not pass when a guard regresses by 5 points.
        broken = [True] * 30 + [False] * 10 + [True] * 38 + [False] * 2
        result = evaluate.verdict(items, base, broken, rule)
        self.assertEqual(result["result"], "FAIL")
        self.assertTrue(result["guards"]["coding"]["regressed"])
        # No primary gain: FAIL even without regressions.
        self.assertEqual(evaluate.verdict(items, base, base, rule)["result"], "FAIL")


class ConfigTest(unittest.TestCase):
    def test_rejects_unknown_keys_and_bad_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "run.json"
            base = {"name": "rouge-1-sft-001", "base_path": "b", "tokenizer_path": "t", "train_file": "d", "output_dir": "o"}
            path.write_text(json.dumps({**base, "quantization": "4bit", "lora": {"rank": 16}}))
            self.assertEqual(RunConfig.load(path).lora.rank, 16)
            path.write_text(json.dumps({**base, "learning_rat": 1}))
            with self.assertRaises(ValueError):
                RunConfig.load(path)
            path.write_text(json.dumps({**base, "quantization": "8bit"}))
            with self.assertRaises(ValueError):
                RunConfig.load(path)


@unittest.skipUnless(HAS_STACK, "needs torch + transformers")
class MaskingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from rouge_train.smoke import tiny_tokenizer

        cls.tmp = tempfile.TemporaryDirectory()
        cls.tokenizer = tiny_tokenizer(Path(cls.tmp.name))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_only_assistant_turns_are_labels(self):
        from rouge_train import data

        stats = data.DataStats()
        record = {"messages": [
            {"role": "system", "content": "be brief"},
            {"role": "user", "content": "Who are you?"},
            {"role": "assistant", "content": "I am Rouge."},
            {"role": "user", "content": "Wer bist du?"},
            {"role": "assistant", "content": "Ich bin Rouge."},
        ]}
        example = data.encode(record, self.tokenizer, 512, stats)
        learned = self.tokenizer.decode([t for t, l in zip(example.input_ids, example.labels) if l != data.IGNORE])
        self.assertIn("I am Rouge.", learned)
        self.assertIn("Ich bin Rouge.", learned)
        self.assertNotIn("Who are you", learned)
        self.assertNotIn("be brief", learned)
        self.assertEqual(learned.count("<|im_end|>"), 2)

    def test_drops_rather_than_truncates(self):
        from rouge_train import data

        stats = data.DataStats()
        long = {"messages": [{"role": "user", "content": "hi " * 400}, {"role": "assistant", "content": "ok"}]}
        self.assertIsNone(data.encode(long, self.tokenizer, 64, stats))
        self.assertEqual(stats.too_long, 1)
        none = {"messages": [{"role": "user", "content": "hi"}]}
        self.assertIsNone(data.encode(none, self.tokenizer, 64, stats))
        self.assertEqual(stats.no_assistant, 1)


if __name__ == "__main__":
    unittest.main()


class IfevalTest(unittest.TestCase):
    def test_supported_instructions_are_checked_strictly(self):
        from rouge_train import ifeval

        spec = {"instructions": [
            {"id": "punctuation:no_comma", "kwargs": {}},
            {"id": "length_constraints:number_words", "kwargs": {"relation": "at least", "num_words": 5}},
            {"id": "startend:end_checker", "kwargs": {"end_phrase": "Is there anything else I can help with?"}},
        ]}
        good = "This answer has no commas at all. Is there anything else I can help with?"
        self.assertTrue(ifeval.check(spec, good))
        self.assertFalse(ifeval.check(spec, good.replace("no commas", "no, commas")))
        self.assertTrue(ifeval.check_one("detectable_format:number_bullet_lists", {"num_bullets": 2}, "* a\n* b"))
        self.assertTrue(ifeval.check_one("detectable_format:json_format", {}, '```json\n{"a": 1}\n```'))
        self.assertTrue(ifeval.check_one("change_case:english_capital", {}, "ALL CAPS"))
        self.assertFalse(ifeval.check_one("keywords:forbidden_words", {"forbidden_words": ["foo"]}, "a Foo b"))
        with self.assertRaises(KeyError):
            ifeval.check_one("language:response_language", {"language": "sw"}, "x")
