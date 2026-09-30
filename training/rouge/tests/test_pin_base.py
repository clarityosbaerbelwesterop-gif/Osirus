import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import pin_base  # noqa: E402


def raw(**changes):
    manifest = {
        "repo": "Example/Model-27B",
        "revision": "a" * 40,
        "license": {"cardLicense": "apache-2.0", "licenseFileSha256": "f" * 64, "licenseLink": None},
        "gated": False,
        "private": False,
        "weights": {"shards": 1, "bytes": 10, "allHashed": True},
        "config": {"text_config": {"dtype": "bfloat16", "max_position_embeddings": 262144}},
        "files": [
            {"path": "model.safetensors", "size": 10, "sha256": "b" * 64, "gitBlob": None},
            {"path": "tokenizer.json", "size": 1, "sha256": "c" * 64, "gitBlob": None},
        ],
    }
    manifest.update(changes)
    return manifest


class PinBaseTest(unittest.TestCase):
    def setUp(self):
        self.previous = json.loads((ROOT.parents[1] / "models" / "rouge-1" / "base.json").read_text())

    def test_pins_in_the_committed_schema_and_records_the_old_base(self):
        pinned = pin_base.pin(raw(), self.previous, run_id="7", decision="owner decision", today="2026-09-30")
        self.assertEqual(pinned["schema"], "rouge.base-manifest/1")
        self.assertEqual(pinned["license"]["spdx"], "Apache-2.0")
        self.assertEqual(pinned["lineage"][0], "base:Example/Model-27B@" + "a" * 40)
        self.assertEqual(pinned["lineage"][1:], self.previous["lineage"][1:])
        self.assertEqual(pinned["tokenizer"]["files"], {"tokenizer.json": "c" * 64})
        self.assertIn("run 7", pinned["source"]["verifiedBy"])
        if self.previous["source"]["repo"] != "Example/Model-27B":
            self.assertEqual(pinned["supersedes"]["repo"], self.previous["source"]["repo"])

    def test_refuses_other_licences_gated_and_unhashed_weights(self):
        for bad in (
            raw(license={"cardLicense": "llama3", "licenseFileSha256": None, "licenseLink": None}),
            raw(gated=True),
            raw(weights={"shards": 1, "bytes": 10, "allHashed": False}),
        ):
            with self.assertRaises(SystemExit):
                pin_base.pin(bad, self.previous, run_id="7", decision="d", today="t")


if __name__ == "__main__":
    unittest.main()
