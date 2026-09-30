"""Lightning storage (hash-verified transfers) and the paid training session's guards, without the network."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lightning_ai"))

import storage  # noqa: E402
import train_session  # noqa: E402


class FakeTeamspace:
    """Teamspace drive stand-in: folders copied into a temporary directory."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp())

    def upload_folder(self, folder_path, remote_path=None, progress_bar=True):
        dst = self.root / remote_path
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(folder_path, dst)

    def download_folder(self, remote_path, target_path=None):
        shutil.copytree(self.root / remote_path, Path(target_path) / Path(remote_path).name, dirs_exist_ok=True)

    def list_files(self, remote_path):
        return list((self.root / remote_path).rglob("*"))


class TestStorage(unittest.TestCase):
    def test_round_trip_and_tamper_detection(self):
        ts, src = FakeTeamspace(), Path(tempfile.mkdtemp())
        (src / "train").mkdir()
        (src / "train" / "a.bin").write_bytes(b"\x00" * 100)
        (src / "manifest.json").write_text("{}")
        storage.upload(str(src), "rouge/data/x", ts=ts)
        got = storage.download("rouge/data/x", tempfile.mkdtemp(), ts=ts)
        self.assertEqual(got["files"], 2)
        (ts.root / "rouge/data/x/train/a.bin").write_bytes(b"\x01" * 100)          # corrupted in storage
        with self.assertRaises(SystemExit):
            storage.download("rouge/data/x", tempfile.mkdtemp(), ts=ts)

    def test_unverified_data_is_refused(self):
        ts = FakeTeamspace()
        (ts.root / "rouge/data/y").mkdir(parents=True)
        (ts.root / "rouge/data/y/a.bin").write_bytes(b"x")
        with self.assertRaises(SystemExit):
            storage.download("rouge/data/y", tempfile.mkdtemp(), ts=ts)


class TestTrainSession(unittest.TestCase):
    def args(self, **kw):
        return type("A", (), {"machine": "H100", "max_hours": 2.0, **kw})()

    def test_refuses_without_training_ready(self):
        with mock.patch.object(Path, "exists", return_value=False):
            with self.assertRaises(SystemExit):
                train_session.preflight(self.args())

    def test_plan_matches_the_ladder(self):
        p = train_session.plan("100m", 32)
        ladder = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())["rungs"]["100m"]
        tokens = int(p["ROUGE_STEPS"]) * int(p["ROUGE_BATCH"]) * int(p["ROUGE_ACCUM"]) * int(p["ROUGE_SEQ"])
        self.assertAlmostEqual(tokens / ladder["tokens"], 1.0, delta=0.01)
        self.assertEqual(p["ROUGE_CONFIG"], "configs/native/rouge-v1-100m.json")


if __name__ == "__main__":
    unittest.main()
