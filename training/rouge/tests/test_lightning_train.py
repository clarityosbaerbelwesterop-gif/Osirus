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

import cost  # noqa: E402
import job as lj  # noqa: E402
import storage  # noqa: E402
import train_session  # noqa: E402


class FakeTeamspace:
    """Model-registry stand-in: every upload is a new version (a copied folder); downloads take the latest."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp())

    def _versions(self, name):
        d = self.root / name
        return sorted(d.iterdir(), key=lambda p: int(p.name[1:])) if d.exists() else []

    def upload_model(self, path, name, version=None, progress_bar=True, metadata=None):
        version = version or f"v{len(self._versions(name)) + 1}"
        shutil.copytree(path, self.root / name / version / Path(path).name)

    def download_model(self, name, download_dir=None, progress_bar=True):
        name, _, version = name.partition(":")
        src = (self.root / name / version) if version else self._versions(name)[-1]
        shutil.copytree(src, download_dir, dirs_exist_ok=True)
        return download_dir

    def list_model_versions(self, name):
        return self._versions(name)


class TestStorage(unittest.TestCase):
    def test_round_trip_and_tamper_detection(self):
        ts, src = FakeTeamspace(), Path(tempfile.mkdtemp())
        (src / "train").mkdir()
        (src / "train" / "a.bin").write_bytes(b"\x00" * 100)
        (src / "manifest.json").write_text("{}")
        storage.upload(str(src), "rouge/data/x", ts=ts)
        got = storage.download("rouge/data/x", tempfile.mkdtemp(), ts=ts)
        self.assertEqual(got["files"], 2)
        self.assertEqual(storage.model_name("rouge/runs/rouge-r1-100m-001@v3"), ("rouge-runs-rouge-r1-100m-001", "v3"))
        self.assertTrue(storage.exists("rouge/data/x", ts=ts))
        stored = next((ts.root / "rouge-data-x").rglob("a.bin"))
        stored.write_bytes(b"\x01" * 100)                                         # corrupted in storage
        with self.assertRaises(SystemExit):
            storage.download("rouge/data/x", tempfile.mkdtemp(), ts=ts)

    def test_unverified_data_is_refused(self):
        ts = FakeTeamspace()
        (ts.root / "rouge-data-y/v1/y").mkdir(parents=True)
        (ts.root / "rouge-data-y/v1/y/a.bin").write_bytes(b"x")
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

    def test_plan_keeps_the_global_batch_on_a_multi_gpu_node(self):
        ladder = json.loads((ROOT / "configs/native/ladder-v1.json").read_text())["rungs"]["100m"]
        one, eight = train_session.plan("100m", 32, 1), train_session.plan("100m", 4, 8)
        for p, n in ((one, 1), (eight, 8)):
            step_tokens = int(p["ROUGE_BATCH"]) * int(p["ROUGE_ACCUM"]) * int(p["ROUGE_SEQ"]) * n
            self.assertAlmostEqual(step_tokens / ladder["batch_tokens"], 1.0, delta=0.01)
            self.assertAlmostEqual(int(p["ROUGE_STEPS"]) * step_tokens / ladder["tokens"], 1.0, delta=0.01)

    def _run(self, logs, interruptible):
        jobs = [type("J", (), {"logs": "\n".join(l)})() for l in logs]
        args = type("A", (), {"machine": "T4_X_8", "max_hours": 5.0, "interruptible": interruptible, "max_attempts": 6,
                              "rung": "100m", "run": "rouge-r1-100m-001", "corpus": "pretrain-v1", "batch": 0,
                              "sha": "abc"})()
        fake_sdk = type(sys)("lightning_sdk")
        fake_sdk.Job, fake_sdk.Machine = object, object
        with mock.patch.dict(sys.modules, {"lightning_sdk": fake_sdk}), \
                mock.patch.dict("os.environ", {"LIGHTNING_API_KEY": "x", "GITHUB_SHA": "abc"}), \
                mock.patch.object(train_session, "preflight", return_value=1.0), \
                mock.patch.object(train_session, "launch", side_effect=[(j, 3.0) for j in jobs]) as launch, \
                mock.patch.object(lj, "load_ledger", return_value={"months": {}}), \
                mock.patch.object(lj, "record_and_wait", return_value=0), \
                mock.patch.object(Path, "write_text"), mock.patch.object(Path, "mkdir"):
            train_session.run(args)
        return launch

    def test_an_interrupted_job_is_relaunched_until_a_terminal_phase(self):
        launch = self._run([["ROUGE_PHASE TRAIN x"], ["ROUGE_PHASE TRAIN x", "ROUGE_PHASE DONE x"]], interruptible=True)
        self.assertEqual(launch.call_count, 2)
        env = launch.call_args[0][4]
        self.assertEqual((env["ROUGE_NPROC"], env["ROUGE_EXPECT_GPU"], env["ROUGE_BATCH"]), ("8", "T4", "4"))

    def test_an_on_demand_job_is_not_relaunched(self):
        self.assertEqual(self._run([["ROUGE_PHASE TRAIN x"]], interruptible=False).call_count, 1)


class FakeOffers:
    id = "ts"
    cloud_accounts = ["b"]

    class _cloud_account_api:  # noqa: N801
        @staticmethod
        def list_global_cloud_accounts(teamspace_id):
            return [type("C", (), {"id": "a"})()]

    def list_machines(self, cloud_account, machine):
        prices = {"a": (6.53, None), "b": (4.50, 3.82)}[cloud_account]
        return [type("M", (), {"cost": prices[0], "interruptible_cost": prices[1]})()]


class TestMachineChoice(unittest.TestCase):
    def test_the_cheapest_cloud_account_wins(self):
        self.assertEqual(train_session.best_offer(FakeOffers(), "H200", False), ("b", 4.50))
        self.assertEqual(train_session.best_offer(FakeOffers(), "H200", True), ("b", 3.82))

    def test_worst_case_at_the_live_price_and_refusal_above_the_ceiling(self):
        self.assertAlmostEqual(cost.worst_case("H200", 2, 4.50), 9.45)
        self.assertAlmostEqual(cost.worst_case("H200", 2), 14.0)
        with self.assertRaises(SystemExit):
            cost.worst_case("T4_X_4", 1, 3.70)   # 4 x 0.90 = 3.60 USD/h ceiling


    def test_every_training_machine_has_a_ceiling_and_a_peak(self):
        self.assertEqual(cost.gpus("T4_X_8"), ("T4", 8))
        self.assertEqual(cost.gpus("H100"), ("H100", 1))
        for m in cost.TRAINING_MACHINES:
            self.assertGreater(cost.PAID_PRICE_CEILING[m], 0)
            self.assertGreater(cost.PEAK_TFLOPS[m], 0)
        self.assertAlmostEqual(cost.worst_case("T4_X_8", 5), 36.0)
        self.assertAlmostEqual(cost.PEAK_TFLOPS["T4_X_8"], 65.0 * 8 * cost.MULTI_GPU_EFFICIENCY)

    def test_cheapest_per_effective_tflop_at_live_prices(self):
        table = [{"name": "H100", "usd_per_hour": 3.29}, {"name": "T4_X_8", "usd_per_hour": 1.52},
                 {"name": "L4_X_4", "usd_per_hour": 9.0}, {"name": "CPU", "usd_per_hour": 0.01}]   # L4_X_4 ceiling 6.20
        with mock.patch.object(cost, "mfu", return_value=0.3):
            # H100: 3.29 / 989 = 0.00333 USD per TFLOP-hour; T4_X_8: 1.52 / 468 = 0.00325; L4_X_4 above its ceiling
            self.assertEqual(lj.cheapest_training_machine(table), "T4_X_8")
            table[1]["usd_per_hour"] = 2.0
            self.assertEqual(lj.cheapest_training_machine(table), "H100")

    def test_mfu_falls_back_to_the_planning_assumption(self):
        self.assertEqual(cost.mfu("T4_X_4", path=Path("/nonexistent")), cost.DEFAULT_MFU)


if __name__ == "__main__":
    unittest.main()
