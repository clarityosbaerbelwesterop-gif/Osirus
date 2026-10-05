"""Test-time compute: majority choice never looks at the solution; the oracle bound is labelled as such."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rouge_train import ttc  # noqa: E402


class TTCTest(unittest.TestCase):
    def test_majority_answer_is_chosen_without_the_solution(self):
        spec = {"type": "numeric", "answer": 391}
        responses = ["17*23 = 381\nAnswer: 381", "Answer: 391", "so the result is 391", "Answer: 1,000"]
        self.assertEqual(ttc.choose(spec, responses), 1)
        # the same answers with a different (wrong) solution choose the same response: the choice is blind
        self.assertEqual(ttc.choose({"type": "numeric", "answer": 381}, responses), 1)

    def test_ties_go_to_the_earliest_and_unvotable_items_keep_the_first_answer(self):
        self.assertEqual(ttc.choose({"type": "numeric", "answer": 1}, ["Answer: 2", "Answer: 1", "Answer: 1", "Answer: 2"]), 0)
        self.assertEqual(ttc.choose({"type": "python_tests", "tests": "assert True"}, ["a", "b"]), 0)
        self.assertEqual(ttc.choose({"type": "numeric", "answer": 1}, ["no number", "none"]), 0)

    def test_german_and_english_notation_vote_together(self):
        spec = {"type": "numeric", "answer": 3600}
        self.assertEqual(ttc.answer_key(spec, "Antwort: 3.600"), ttc.answer_key(spec, "Answer: 3,600"))

    def test_dates_vote_on_the_last_iso_date(self):
        spec = {"type": "regex", "pattern": "2031-08-28"}
        responses = ["2031-08-27", "Start 2031-06-01, result 2031-08-28", "Ergebnis: 2031-08-28"]
        self.assertEqual(ttc.choose(spec, responses), 1)

    def test_report_separates_result_and_oracle_bound(self):
        items = [{"id": "a", "category": "reasoning", "check": {"type": "numeric", "answer": 5}},
                 {"id": "b", "category": "reasoning", "check": {"type": "numeric", "answer": 7}},
                 {"id": "c", "category": "code", "check": {"type": "contains_all", "terms": ["def"]}}]
        samples = {"a": ["Answer: 4", "Answer: 5", "Answer: 5"],      # majority fixes a wrong first answer
                   "b": ["Answer: 7", "Answer: 8", "Answer: 8"],      # majority breaks a right first answer
                   "c": ["x", "def f(): pass", "y"]}                  # not votable: first answer counts
        rep = ttc.report(items, samples)
        overall = rep["overall"]
        self.assertEqual(overall["n"], 3)
        self.assertEqual(overall["pass@1"], round(1 / 3, 4))
        self.assertEqual(overall["maj@k"], round(1 / 3, 4))
        self.assertEqual(overall["oracle_pass@k (bound, not a result)"], 1.0)
        self.assertEqual((overall["maj_better"], overall["maj_worse"]), (1, 1))
        self.assertEqual(overall["votable_share"], round(2 / 3, 4))
        self.assertEqual(rep["k"], 3)


if __name__ == "__main__":
    unittest.main()
