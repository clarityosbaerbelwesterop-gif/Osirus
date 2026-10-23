import unittest

from sequential import (
    sprt_bernoulli, empirical_bernstein_sequential, DualStreamDriftMonitor,
    guarded_promotion_decision,
)
from environment import make_observations, make_drift_sequence
from evaluate import run_method, METHODS, observed_noise_fields


class TestM19(unittest.TestCase):
    def test_sprt_high_evidence_accepts_candidate(self):
        result = sprt_bernoulli([1] * 100, max_n=100)
        self.assertEqual(result.status, "accept_candidate")
        self.assertLessEqual(result.n, 100)

    def test_sprt_low_evidence_rejects_candidate(self):
        self.assertEqual(sprt_bernoulli([0] * 100, max_n=100).status, "reject_candidate")

    def test_sprt_budget_exhaustion_is_inconclusive(self):
        result = sprt_bernoulli([1, 0] * 20, max_n=3)
        self.assertEqual(result.status, "inconclusive")
        self.assertEqual(result.n, 3)

    def test_bernstein_accepts_strong_evidence(self):
        result = empirical_bernstein_sequential([1] * 4000, max_n=4000)
        self.assertEqual(result.status, "accept_candidate")
        self.assertGreater(result.lower_bound, .85)

    def test_bernstein_budget_exhaustion_does_not_promote(self):
        self.assertEqual(empirical_bernstein_sequential([1, 0] * 10, max_n=20).status, "inconclusive")

    def test_invalid_probability_order_rejected(self):
        with self.assertRaises(ValueError):
            sprt_bernoulli([1], p0=.95, p1=.85)

    def test_invalid_observation_rejected(self):
        with self.assertRaises(ValueError):
            sprt_bernoulli([2])

    def test_no_identifying_evidence_abstains(self):
        outcome = run_method("sequential_sprt", [])
        self.assertFalse(outcome["accepted_by_statistical_gate"])
        self.assertEqual(outcome["status"], "abstain")

    def test_unidentifiable_task_stays_unaccepted(self):
        for method in METHODS:
            self.assertFalse(run_method(method, [])["accepted_by_statistical_gate"])

    def test_drift_monitor_distinguishes_target_shift_from_common_noise(self):
        monitor = DualStreamDriftMonitor()
        alarm = None
        for target, anchor in make_drift_sequence(3, "concept_drift"):
            alarm = monitor.update(target, anchor)
            if alarm:
                break
        self.assertEqual(alarm, "target_specific_drift")

    def test_noise_surge_is_not_claimed_as_target_specific_drift(self):
        monitor = DualStreamDriftMonitor()
        alarm = None
        for target, anchor in make_drift_sequence(3, "noise_surge"):
            alarm = monitor.update(target, anchor)
            if alarm:
                break
        self.assertEqual(alarm, "common_mode_noise_or_environment_shift")

    def test_stationary_sequence_has_no_alarm(self):
        monitor = DualStreamDriftMonitor()
        for target, anchor in make_drift_sequence(1, "stationary"):
            monitor.update(target, anchor)
        self.assertIsNone(monitor.alarm)

    def test_statistical_acceptance_alone_cannot_promote_or_mutate_memory(self):
        result = guarded_promotion_decision("accept_candidate", independent_validation_pass=False,
                                            adversarial_checks_pass=True, regression_pass=True,
                                            rollback_available=True)
        self.assertFalse(result["eligible_for_promotion"])
        self.assertFalse(result["productive_memory_mutated"])
        self.assertIn("independent_validation", result["failed_gates"])

    def test_all_m17_preconditions_only_grant_eligibility(self):
        result = guarded_promotion_decision("accept_candidate", independent_validation_pass=True,
                                            adversarial_checks_pass=True, regression_pass=True,
                                            rollback_available=True)
        self.assertTrue(result["eligible_for_promotion"])
        self.assertFalse(result["productive_memory_mutated"])
        self.assertEqual(result["status"], "eligible_pending_existing_promotion_transaction")

    def test_insufficient_evidence_does_not_get_padded(self):
        result = run_method("sequential_sprt", make_observations(1, "insufficient_evidence"))
        self.assertEqual(result["status"], "inconclusive")
        self.assertEqual(result["n"], 10)
        self.assertFalse(result["accepted_by_statistical_gate"])


    def test_observed_noise_rate_is_estimated_from_consumed_binary_outcomes(self):
        result = observed_noise_fields([1, 1, 0, 1])
        self.assertAlmostEqual(result["estimated_noise_rate"], 0.25)
        self.assertEqual(result["estimated_noise_rate_wilson_95"]["numerator"], 1)
        self.assertEqual(result["estimated_noise_rate_wilson_95"]["denominator"], 4)

    def test_observed_noise_is_undefined_without_evidence(self):
        result = observed_noise_fields([])
        self.assertIsNone(result["estimated_noise_rate"])
        self.assertIsNone(result["estimated_noise_rate_wilson_95"])

    def test_observations_are_seed_deterministic(self):
        self.assertEqual(make_observations(7, "noise_5_percent", 50),
                         make_observations(7, "noise_5_percent", 50))


if __name__ == "__main__":
    unittest.main()
