"""Rouge on exo: the model card written for a converted checkpoint (stdlib only)."""

import json
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "serve"))

import exo_runtime  # noqa: E402

# Fields exo's ModelCard requires (exo-explore/exo src/exo/shared/models/model_cards.py at 21a54c5)
REQUIRED = {"model_id", "storage_size", "n_layers", "hidden_size", "supports_tensor", "tasks", "backends"}


class ExoCardTest(unittest.TestCase):
    def test_card_comes_from_the_checkpoint_config_and_never_trusts_remote_code(self):
        base = json.loads((Path(__file__).resolve().parents[3] / "models" / "rouge-1" / "base.json").read_text())
        with tempfile.TemporaryDirectory() as tmp:
            model_dir = Path(tmp) / exo_runtime.normalize("osirus/rouge-1-rl-001-4bit")
            model_dir.mkdir()
            (model_dir / "config.json").write_text(json.dumps(base["config"]))
            (model_dir / "model.safetensors").write_bytes(b"\0" * 1234)
            path = exo_runtime.write_card(Path(tmp) / "cards", model_dir, "osirus/rouge-1-rl-001-4bit",
                                          quantization="4bit", base_model="Rouge 1")
            self.assertEqual(path.name, "osirus--rouge-1-rl-001-4bit.toml")
            card = tomllib.loads(path.read_text())
        self.assertTrue(REQUIRED <= set(card))
        text = base["config"]["text_config"]
        self.assertEqual(card["n_layers"], text["num_hidden_layers"])
        self.assertEqual(card["hidden_size"], text["hidden_size"])
        self.assertEqual(card["num_key_value_heads"], text["num_key_value_heads"])
        self.assertEqual(card["storage_size"]["in_bytes"], 1234)
        self.assertIs(card["trust_remote_code"], False)
        self.assertEqual(card["sampling_defaults"]["top_k"], 20)

    def test_card_refuses_a_directory_without_weights(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "config.json").write_text(json.dumps({"num_hidden_layers": 2, "hidden_size": 8, "num_key_value_heads": 1}))
            with self.assertRaises(SystemExit):
                exo_runtime.card(Path(tmp), "x/y", quantization="4bit", base_model="t")


class ExoReadinessTest(unittest.TestCase):
    """Shapes as exo's /state serialises them (tagged unions: {"ClassName": {...}})."""

    INSTANCE = {"MlxRingInstance": {"shard_assignments": {"model_id": "m/x", "runner_to_shard": {"r1": {}, "r2": {}}}}}

    @staticmethod
    def failed_download(model_id):
        shard = {"PipelineShardMetadata": {"model_card": {"model_id": model_id}}}
        return {"DownloadFailed": {"node_id": "n", "shard_metadata": shard, "error_message": "401"}}

    def test_ready_only_when_every_runner_of_the_instance_serves(self):
        ids = exo_runtime.runner_ids(self.INSTANCE)
        self.assertEqual(ids, ["r1", "r2"])
        self.assertIsNone(exo_runtime.readiness({}, {}, ids, "m/x"))
        loading = {"r1": {"RunnerReady": {}}, "r2": {"RunnerLoading": {"layers_loaded": 3, "total_layers": 24}}}
        self.assertIsNone(exo_runtime.readiness(loading, {}, ids, "m/x"))
        ready = {"r1": {"RunnerReady": {}}, "r2": {"RunnerRunning": {}}}
        self.assertEqual(exo_runtime.readiness(ready, {}, ids, "m/x"), "ready")

    def test_a_failed_runner_or_a_failed_download_of_this_model_stops_the_wait(self):
        ids = ["r1"]
        with self.assertRaises(SystemExit):
            exo_runtime.readiness({"r1": {"RunnerFailed": {"error_message": "oom", "diagnostics": []}}}, {}, ids, "m/x")
        with self.assertRaises(SystemExit):
            exo_runtime.readiness({}, {"n": [self.failed_download("m/x")]}, ids, "m/x")
        # /state serialises with camelCase aliases
        shard = {"PipelineShardMetadata": {"modelCard": {"modelId": "m/x"}}}
        camel = {"DownloadFailed": {"nodeId": "n", "shardMetadata": shard, "errorMessage": "401"}}
        with self.assertRaises(SystemExit):
            exo_runtime.readiness({}, {"n": [camel]}, ids, "m/x")
        # a failed status check for another card (exo checks every known card) does not
        self.assertIsNone(exo_runtime.readiness({}, {"n": [self.failed_download("other/model")]}, ids, "m/x"))


if __name__ == "__main__":
    unittest.main()
