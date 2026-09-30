import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("resource_gate", Path(__file__).parents[1] / "resource_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class ResourceGateTests(unittest.TestCase):
    def test_trillion_parameter_weights_reject_32gb(self):
        for params, expected_bytes in ((2_000_000_000_000, 1_000_000_000_000),
                                       (3_000_000_000_000, 1_500_000_000_000)):
            r = gate.assess(params, 4, 32_000_000_000)
            self.assertEqual(r["weight_bytes_lower_bound"], expected_bytes)
            self.assertEqual(r["status"], "REJECT_SINGLE_DEVICE_RESIDENT")

    def test_small_model_is_not_training_fit_confirmation(self):
        r = gate.assess(8_000_000_000, 4, 32_000_000_000)
        self.assertEqual(r["status"], "NEEDS_MEASURED_DRY_RUN")
        self.assertFalse(r["training_fit_confirmed"])

    def test_round_up_partial_byte_and_invalid_inputs(self):
        self.assertEqual(gate.assess(3, 2, 8)["weight_bytes_lower_bound"], 1)
        for args in ((0, 4, 8), (8, 3, 8), (8, 4, 0)):
            with self.assertRaises(ValueError):
                gate.assess(*args)
