"""Unit tests for the stdlib-only worker logic: python -m unittest discover -s ai-lab/gitops/worker"""

import os
import unittest

import jobs

SHA = "a" * 40


def payload(**over):
    p = {
        "schema": jobs.PAYLOAD_SCHEMA,
        "jobId": "train:quasnir-1",
        "stage": "train",
        "target": "quasnir-1",
        "runId": "quasnir-1-train-20261005000000-deadbeef",
        "inputHash": "b" * 64,
        "commitSha": SHA,
        "repository": "owner/repo",
        "provider": "runpod",
        "timeoutMs": 3_600_000,
        "costRateUsdPerHour": 1.89,
        "callback": {"eventType": "gitops-run-finished"},
        "train": {
            "base": {"repo": "google/gemma-3-27b-it", "revision": SHA},
            "datasets": [{"repo": "org/golden", "revision": SHA}],
            "publish": "org/quasnir-1-qlora",
        },
    }
    p.update(over)
    return p


class ValidatePayload(unittest.TestCase):
    def test_accepts_rendered_shape(self):
        jobs.validate_payload(payload())

    def test_rejects_unpinned_reference(self):
        p = payload()
        p["train"]["base"]["revision"] = "main"
        with self.assertRaises(jobs.PayloadError):
            jobs.validate_payload(p)

    def test_rejects_unknown_schema_and_stage(self):
        with self.assertRaises(jobs.PayloadError):
            jobs.validate_payload(payload(schema="other"))
        with self.assertRaises(jobs.PayloadError):
            jobs.validate_payload(payload(stage="synth"))


class Shaping(unittest.TestCase):
    def test_messages_become_prompt_completion(self):
        row = {"messages": [{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]}
        self.assertEqual(
            jobs.to_prompt_completion(row),
            {"prompt": [{"role": "user", "content": "q"}], "completion": [{"role": "assistant", "content": "a"}]},
        )

    def test_rejects_rows_without_an_answer(self):
        with self.assertRaises(jobs.PayloadError):
            jobs.to_prompt_completion({"messages": [{"role": "user", "content": "q"}]})


class Metrics(unittest.TestCase):
    suites = [{"id": "mbpp", "task": "mbpp", "metric": "pass_at_1,none"}]

    def test_extracts_declared_metric(self):
        out = jobs.extract_metrics({"mbpp": {"pass_at_1,none": 0.41, "alias": "mbpp"}}, self.suites)
        self.assertEqual(out, [{"suite": "mbpp", "metric": "pass_at_1,none", "value": 0.41}])

    def test_missing_metric_names_available_keys(self):
        with self.assertRaisesRegex(KeyError, "available: \\['pass@1,none'\\]"):
            jobs.extract_metrics({"mbpp": {"pass@1,none": 0.4}}, self.suites)


class Records(unittest.TestCase):
    def test_failure_is_recorded_with_scrubbed_error(self):
        os.environ["HF_TOKEN"] = "hf_secret_value"
        try:
            rec = jobs.build_record(
                payload(), provider_job_id="rp/1", started_at="t0", finished_at="t1", elapsed_hours=0.5,
                outputs=None, metrics=[], error="boom hf_secret_value",
            )
        finally:
            del os.environ["HF_TOKEN"]
        self.assertEqual(rec["status"], "failed")
        self.assertEqual(rec["error"], "boom <HF_TOKEN>")
        self.assertEqual(rec["providerJobId"], "rp-1")
        self.assertEqual(rec["costUsd"], 0.94)
        self.assertIsNone(rec["outputs"])

    def test_success_requires_outputs(self):
        rec = jobs.build_record(
            payload(), provider_job_id="x", started_at="t0", finished_at="t1", elapsed_hours=1,
            outputs={"uri": "hf://org/a", "revision": SHA}, metrics=[], error=None,
        )
        self.assertEqual(rec["status"], "succeeded")
        self.assertIsNone(rec["error"])


if __name__ == "__main__":
    unittest.main()
