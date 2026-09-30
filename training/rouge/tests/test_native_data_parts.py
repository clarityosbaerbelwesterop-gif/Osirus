"""Corpus built one source per runner: manifest merge and fetch of the parts (no network)."""

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "lightning_ai"))

from native.data import merge  # noqa: E402

TOK = b'{"tokenizer": 1}'


def part(name: str, root: Path) -> dict:
    data = bytes(range(8)) * 4                                # 16 uint16 tokens
    for split in ("train", "val"):
        (root / split).mkdir(parents=True, exist_ok=True)
        (root / split / f"{name}_0000.bin").write_bytes(data)
    (root / "tokenizer.json").write_bytes(TOK)
    shard = {"tokens": 16, "files": [{"path": f"train/{name}_0000.bin", "tokens": 16, "sha256": hashlib.sha256(data).hexdigest()}]}
    val = {"tokens": 16, "files": [{"path": f"val/{name}_0000.bin", "tokens": 16, "sha256": hashlib.sha256(data).hexdigest()}]}
    return {"tokenizer": {"sha256": hashlib.sha256(TOK).hexdigest(), "vocab": 32768}, "decontamination_rule": "v3",
            "revisions": {name: "abc"}, "sources": {name: {"shards": {"train": shard, "val": val}}}}


class TestParts(unittest.TestCase):
    def test_merge_needs_every_source_and_one_tokenizer(self):
        with mock.patch.dict(merge.sources.MIXTURES, {"t": {"a": 0.5, "b": 0.5}}):
            tmp = Path(tempfile.mkdtemp())
            pa, pb = part("a", tmp / "a"), part("b", tmp / "b")
            m = merge.merge([pa, pb], "t", 32, "c")
            self.assertEqual(m["parts"], {"a": "rouge/data/c/a", "b": "rouge/data/c/b"})
            with self.assertRaises(SystemExit):
                merge.merge([pa], "t", 32, "c")
            pb["tokenizer"] = {"sha256": "other", "vocab": 1}
            with self.assertRaises(SystemExit):
                merge.merge([pa, pb], "t", 32, "c")

    def test_fetch_unpacks_parts_into_one_verified_directory(self):
        import corpus

        tmp = Path(tempfile.mkdtemp())
        with mock.patch.dict(merge.sources.MIXTURES, {"t": {"a": 0.5, "b": 0.5}}):
            m = merge.merge([part("a", tmp / "src-a"), part("b", tmp / "src-b")], "t", 32, "c")
        cfg = tmp / "configs/native/c"
        cfg.mkdir(parents=True)
        (cfg / "manifest.json").write_text(json.dumps(m))

        def download(remote, local):   # the registry model of a part, as storage.download leaves it
            name = remote.rsplit("/", 1)[1]
            part(name, Path(local) / "nested")
            return {"root": str(Path(local) / "nested")}

        with mock.patch.object(corpus, "ROOT", tmp):
            out = corpus.fetch("c", str(tmp / "data"), download=download)
        self.assertTrue((out / "train/a_0000.bin").exists() and (out / "val/b_0000.bin").exists())
        self.assertEqual(json.loads((out / "manifest.json").read_text())["parts"]["b"], "rouge/data/c/b")


if __name__ == "__main__":
    unittest.main()
