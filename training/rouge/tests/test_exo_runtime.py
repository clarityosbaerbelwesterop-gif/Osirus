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


if __name__ == "__main__":
    unittest.main()
