"""Tests for the Rouge training layer (stdlib unittest; no GPU, no weights)."""

from __future__ import annotations

import copy
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rouge_train import checkpoints, manifest, registry  # noqa: E402
from rouge_train.seeds import seed_everything  # noqa: E402


class BaseManifestTest(unittest.TestCase):
    def test_pinned_base_is_exact_and_apache(self):
        base = manifest.load_base()
        self.assertRegex(base["source"]["repo"], r"^Qwen/Qwen3\.[568]-27B$")
        self.assertRegex(base["source"]["revision"], r"^[0-9a-f]{40}$")
        self.assertEqual(base["license"]["spdx"], "Apache-2.0")
        shards = [f for f in base["files"] if f["path"].endswith(".safetensors")]
        self.assertEqual(len(shards), base["weights"]["shards"])
        self.assertTrue(all(len(f["sha256"]) == 64 for f in shards))
        self.assertEqual(sum(f["size"] for f in shards), base["weights"]["bytes"])
        text = base["config"]["text_config"]
        self.assertEqual(text["max_position_embeddings"], 262144)
        self.assertEqual(text["num_hidden_layers"], 64)
        self.assertEqual(text["layer_types"].count("full_attention"), 16)
        self.assertTrue(all(base["tokenizer"]["files"].values()))
        self.assertEqual(
            manifest.base_ref(base),
            f"base:{base['source']['repo']}@{base['source']['revision']}",
        )

    def test_download_verification_catches_missing_and_changed_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            good, bad = b"weights-a", b"weights-b"
            (root / "a.safetensors").write_bytes(good)
            (root / "b.safetensors").write_bytes(b"tampered")
            fake = {
                "files": [
                    {"path": "a.safetensors", "size": len(good), "sha256": hashlib.sha256(good).hexdigest()},
                    {"path": "b.safetensors", "size": len(bad), "sha256": hashlib.sha256(bad).hexdigest()},
                    {"path": "c.safetensors", "size": 1, "sha256": "0" * 64},
                    {"path": ".gitattributes", "size": 1, "sha256": None},
                ]
            }
            result = manifest.verify_download(root, fake)
            self.assertEqual(result.checked, 2)
            self.assertEqual(result.mismatched, ["b.safetensors"])
            self.assertEqual(result.missing, ["c.safetensors"])
            self.assertFalse(result.ok)


def make_checkpoint(tmp: Path, name: str, parent: str) -> dict:
    weights = tmp / name
    weights.mkdir()
    (weights / "adapter_model.safetensors").write_bytes(name.encode())
    return checkpoints.create(
        name=name,
        parent=parent,
        kind="adapter",
        weights_dir=weights,
        run={"id": f"run-{name}", "code_commit": "abc123", "environment_lock_sha256": "f" * 64, "hardware": "8xH200"},
        data={"registry_version": "2026-09-28.1", "mixture": "sft-mix-001", "tokens": 1000},
        hyperparameters={"lr": 1e-4, "lora_r": 64},
        seed=7,
        storage_uri=f"s3://rouge/{name}",
    )


class CheckpointTest(unittest.TestCase):
    def test_names_follow_the_lineage_scheme(self):
        for good in ("rouge-1", "rouge-1-sft-001", "rouge-1-reasoning-002", "rouge-1-context-003", "rouge-1-rc1", "rouge-1-exp-001", "rouge-1-edge-001"):
            self.assertEqual(checkpoints.check_name(good), good)
        for bad in ("rouge-2-sft-001", "rouge-1-sft-1", "rouge-1-magic-001", "Rouge-1"):
            with self.assertRaises(checkpoints.ManifestError):
                checkpoints.check_name(bad)

    def test_manifest_requires_provenance_and_detects_tampering(self):
        base = manifest.base_ref(manifest.load_base())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sft = make_checkpoint(root, "rouge-1-sft-001", base)
            self.assertEqual(sft["status"], "candidate")
            self.assertEqual(checkpoints.verify(sft, root / "rouge-1-sft-001"), [])
            (root / "rouge-1-sft-001" / "adapter_model.safetensors").write_bytes(b"x")
            self.assertEqual(
                checkpoints.verify(sft, root / "rouge-1-sft-001"),
                ["changed adapter_model.safetensors"],
            )
            with self.assertRaises(checkpoints.ManifestError):
                checkpoints.create(
                    name="rouge-1-sft-002",
                    parent=base,
                    kind="adapter",
                    weights_dir=root / "rouge-1-sft-001",
                    run={"id": "r"},
                    data={"registry_version": "v", "mixture": "m", "tokens": 1},
                    hyperparameters={},
                    seed=1,
                    storage_uri="s3://x",
                )

    def test_lineage_walks_back_to_the_pinned_base(self):
        base = manifest.base_ref(manifest.load_base())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            a = make_checkpoint(root, "rouge-1-sft-001", base)
            b = make_checkpoint(root, "rouge-1-reasoning-002", "rouge-1-sft-001")
            store = {a["name"]: a, b["name"]: b}
            self.assertEqual(
                checkpoints.lineage("rouge-1-reasoning-002", store),
                ["rouge-1-reasoning-002", "rouge-1-sft-001", base],
            )

    def test_promotion_needs_a_held_out_gain_and_no_regression(self):
        base = manifest.base_ref(manifest.load_base())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            parent = make_checkpoint(root, "rouge-1-sft-001", base)
            child = make_checkpoint(root, "rouge-1-reasoning-002", "rouge-1-sft-001")
            for ckpt, math, writing in ((parent, 0.60, 0.80), (child, 0.70, 0.79)):
                checkpoints.add_evaluation(ckpt, suite="math", version="v1", split="holdout", metrics={"score": math}, run="e")
                checkpoints.add_evaluation(ckpt, suite="writing", version="v1", split="holdout", metrics={"score": writing}, run="e")
            ok, reasons = checkpoints.promotion_decision(
                child, parent, targets={"math": "v1"}, guards={"writing": ("v1", 0.02)}
            )
            self.assertTrue(ok, reasons)

            regressed = copy.deepcopy(child)
            regressed["evaluations"][1]["metrics"]["score"] = 0.70
            ok, reasons = checkpoints.promotion_decision(
                regressed, parent, targets={"math": "v1"}, guards={"writing": ("v1", 0.02)}
            )
            self.assertFalse(ok)
            self.assertTrue(any("regressed" in r for r in reasons))

            # A score measured on a training or dev split never counts.
            dev_only = copy.deepcopy(child)
            for evaluation in dev_only["evaluations"]:
                evaluation["split"] = "dev"
            ok, reasons = checkpoints.promotion_decision(
                dev_only, parent, targets={"math": "v1"}, guards={}
            )
            self.assertFalse(ok)


class RegistryTest(unittest.TestCase):
    def test_registry_is_valid_and_only_approved_training_data_is_trainable(self):
        loaded = registry.load()
        trainable = {e["id"] for e in registry.trainable(loaded)}
        self.assertIn("rouge-verified-tasks", trainable)
        self.assertNotIn("ultrafeedback-binarized", trainable)
        self.assertNotIn("smoltalk", trainable)
        eval_only = {e["id"] for e in loaded["datasets"] if e["role"] == "eval-only"}
        self.assertTrue({"mgsm", "mbpp", "ifeval"} <= eval_only)
        self.assertFalse(trainable & eval_only)

    def test_approval_requires_licence_evidence_revision_and_teacher_terms(self):
        entry = {
            "id": "x",
            "source": "hf:org/x",
            "license": "CC-BY-4.0",
            "status": "approved",
            "role": "train",
            "domains": ["math"],
        }
        self.assertIn("licence not verified against the source", registry.approval_blockers(entry))
        self.assertIn("source revision is not pinned", registry.approval_blockers(entry))
        entry.update(revision="a" * 40, licenseVerified={"at": "2026-09-28", "evidence": "run 1"})
        self.assertEqual(registry.approval_blockers(entry), [])
        entry["teacherOutputs"] = {"model": "closed model", "termsPermitTraining": False}
        self.assertTrue(registry.approval_blockers(entry))
        entry.pop("teacherOutputs")
        entry["license"] = "CC-BY-NC-4.0"
        self.assertTrue(registry.approval_blockers(entry))
        entry["license"] = "CC-BY-4.0"
        entry["role"] = "eval-only"
        self.assertIn("evaluation-only data never trains Rouge", registry.approval_blockers(entry))


class SeedTest(unittest.TestCase):
    def test_seeding_is_reproducible(self):
        import random

        seed_everything(11)
        first = [random.random() for _ in range(3)]
        seed_everything(11)
        self.assertEqual(first, [random.random() for _ in range(3)])


if __name__ == "__main__":
    unittest.main()


class GeneratorTest(unittest.TestCase):
    def test_generated_data_is_correct_disjoint_and_reproducible(self):
        import re

        from rouge_train import evaluate, generators

        train = list(generators.sft_records("s1", 400))
        self.assertEqual(train, list(generators.sft_records("s1", 400)))
        families = {r["family"] for r in train}
        self.assertEqual(families, {"worked-math", "structured", "uncertainty", "identity"})
        self.assertEqual({r["lang"] for r in train}, {"en", "de"})
        # Every training prompt is unique: no record is a repeat to memorise.
        prompts = [generators.normalise(r["messages"][0]["content"]) for r in train]
        self.assertEqual(len(prompts), len(set(prompts)))
        for record in train:
            answer = record["messages"][1]["content"]
            if record["family"] == "identity":
                self.assertIn(generators.base_name(), answer)
                # "From scratch" may only appear as a denial.
                if "from scratch" in answer:
                    self.assertRegex(answer, r"^No\b|rather than|not ")
                self.assertNotRegex(answer, r"(?i)\bI (was|am) (pre)?trained from scratch")
            question = record["messages"][0]["content"]
            change = re.match(r"\w+ (?:buys|kauft) (\d+) .* (?:\$|)(\d+)(?:-€-Schein| bill)", question)
            if change:
                # The missing unit price is named, and the worked example is exact.
                self.assertRegex(answer, r"price per|Preis pro")
                count, paid = int(change.group(1)), int(change.group(2))
                example = re.search(r"(\d+[.,]\d{2}) = \$?(\d+[.,]\d{2})", answer)
                price, rest = (float(x.replace(",", ".")) for x in example.groups())
                self.assertAlmostEqual(paid - count * price, rest, places=2)
            product = re.match(r"(?:Compute|Berechne) ([\d.,]+) × ([\d.,]+)", question)
            if product:
                a, b = (int(re.sub(r"[.,]", "", x)) for x in product.groups())
                self.assertTrue(evaluate.check({"type": "numeric", "answer": a * b}, answer.replace(".", "")))

        items = list(generators.eval_items("e1", 100))
        eval_prompts = {i["messages"][0]["content"] for i in items}
        big = list(generators.sft_records("s1", 5000))
        clean, removed = generators.decontaminate(big, eval_prompts)
        self.assertEqual(len(clean) + removed, len(big))
        self.assertFalse({r["messages"][0]["content"] for r in clean} & eval_prompts)
        # The generators' spaces are large: collisions are rare, not routine.
        self.assertLess(removed, 5)
        for item in items:
            check = item["check"]
            if check["type"] == "numeric":
                self.assertTrue(evaluate.check(check, f"Answer: {check['answer']}"))
            elif check["type"] == "regex":
                self.assertTrue(evaluate.check(check, check["pattern"].replace("\\b", "")))
