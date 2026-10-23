"""M19 sequential decision rules with explicit assumptions and safe inconclusive states."""
from dataclasses import dataclass
import math
from typing import Iterable, List


@dataclass(frozen=True)
class Decision:
    status: str
    n: int
    successes: int
    estimate: float
    lower_bound: float | None = None
    upper_bound: float | None = None
    log_likelihood_ratio: float | None = None
    reason: str = ""


def _validate_stream(observations: Iterable[int], max_n: int) -> List[int]:
    if max_n < 1:
        raise ValueError("max_n must be >= 1")
    values = []
    for x in observations:
        if isinstance(x, bool):
            x = int(x)
        if x not in (0, 1):
            raise ValueError("observations must be binary 0/1 values")
        values.append(int(x))
        if len(values) >= max_n:
            break
    if not values:
        raise ValueError("observations must not be empty")
    return values


def sprt_bernoulli(observations: Iterable[int], *, p0: float = 0.85, p1: float = 0.95,
                   alpha: float = 0.05, beta: float = 0.10, max_n: int = 4000) -> Decision:
    """Wald SPRT for simple Bernoulli H0:p=p0 versus H1:p=p1.

    Nominal guarantees require independent Bernoulli observations under the stated fixed
    distributions. Values between p0 and p1 are an indifference region.
    """
    if not (0 < p0 < p1 < 1):
        raise ValueError("require 0 < p0 < p1 < 1")
    if not (0 < alpha < 1 and 0 < beta < 1):
        raise ValueError("alpha and beta must be in (0,1)")
    vals = _validate_stream(observations, max_n)
    upper = math.log((1.0 - beta) / alpha)
    lower = math.log(beta / (1.0 - alpha))
    llr = 0.0
    successes = 0
    for idx, x in enumerate(vals, start=1):
        successes += x
        llr += math.log(p1 / p0) if x else math.log((1.0 - p1) / (1.0 - p0))
        if llr >= upper:
            return Decision("accept_candidate", idx, successes, successes / idx,
                            log_likelihood_ratio=llr, reason="upper_sprt_boundary")
        if llr <= lower:
            return Decision("reject_candidate", idx, successes, successes / idx,
                            log_likelihood_ratio=llr, reason="lower_sprt_boundary")
    n = len(vals)
    return Decision("inconclusive", n, successes, successes / n,
                    log_likelihood_ratio=llr, reason="max_samples_without_boundary")


def empirical_bernstein_sequential(observations: Iterable[int], *, threshold: float = 0.85,
                                   alpha: float = 0.05, max_n: int = 4000) -> Decision:
    """Time-uniform empirical-Bernstein test using alpha-spending.

    At time t, delta_t = alpha*6/(pi^2*t^2), whose sum is <= alpha. The fixed-time
    empirical-Bernstein radius is combined with this schedule using a union bound.
    This conservative construction assumes independent [0,1]-bounded observations.
    """
    if not (0 < threshold < 1):
        raise ValueError("threshold must be in (0,1)")
    if not (0 < alpha < 1):
        raise ValueError("alpha must be in (0,1)")
    if max_n < 2:
        raise ValueError("max_n must be >= 2")
    vals = _validate_stream(observations, max_n)
    successes = 0
    last_bounds = (0.0, 1.0)
    for n, x in enumerate(vals, start=1):
        successes += x
        if n < 2:
            continue
        mean = successes / n
        variance = (n / (n - 1.0)) * mean * (1.0 - mean)
        delta_t = alpha * 6.0 / (math.pi * math.pi * n * n)
        log_term = math.log(2.0 / delta_t)
        radius = math.sqrt(max(0.0, 2.0 * variance * log_term / n)) + (7.0 * log_term) / (3.0 * (n - 1.0))
        lower = max(0.0, mean - radius)
        upper = min(1.0, mean + radius)
        last_bounds = (lower, upper)
        if lower > threshold:
            return Decision("accept_candidate", n, successes, mean, lower, upper,
                            reason="time_uniform_lower_bound_above_threshold")
        if upper < threshold:
            return Decision("reject_candidate", n, successes, mean, lower, upper,
                            reason="time_uniform_upper_bound_below_threshold")
    n = len(vals)
    mean = successes / n
    return Decision("inconclusive", n, successes, mean, last_bounds[0], last_bounds[1],
                    reason="max_samples_without_valid_boundary")


class DualStreamDriftMonitor:
    """Compare target probes against stable calibration anchors.

    The distinction is justified only while anchor semantics remain stable.
    """
    def __init__(self, window: int = 20, min_baseline: int = 20,
                 drop_threshold: float = 0.30, anchor_tolerance: float = 0.15):
        if window < 2 or min_baseline < window:
            raise ValueError("require window >= 2 and min_baseline >= window")
        if not (0 < drop_threshold < 1 and 0 < anchor_tolerance < 1):
            raise ValueError("thresholds must be in (0,1)")
        self.window = window
        self.min_baseline = min_baseline
        self.drop_threshold = drop_threshold
        self.anchor_tolerance = anchor_tolerance
        self.target = []
        self.anchor = []
        self.baseline_target = None
        self.baseline_anchor = None
        self.alarm = None
        self.alarm_at = None

    def update(self, target_match: int, anchor_match: int):
        if target_match not in (0, 1) or anchor_match not in (0, 1):
            raise ValueError("drift monitor observations must be binary")
        self.target.append(int(target_match))
        self.anchor.append(int(anchor_match))
        n = len(self.target)
        if self.baseline_target is None and n >= self.min_baseline:
            self.baseline_target = sum(self.target[:self.min_baseline]) / self.min_baseline
            self.baseline_anchor = sum(self.anchor[:self.min_baseline]) / self.min_baseline
        if self.alarm is not None or self.baseline_target is None or n < self.min_baseline + self.window:
            return self.alarm
        recent_target = sum(self.target[-self.window:]) / self.window
        recent_anchor = sum(self.anchor[-self.window:]) / self.window
        target_drop = self.baseline_target - recent_target
        anchor_drop = self.baseline_anchor - recent_anchor
        if target_drop >= self.drop_threshold and anchor_drop < self.anchor_tolerance:
            self.alarm, self.alarm_at = "target_specific_drift", n
        elif target_drop >= self.drop_threshold and anchor_drop >= self.anchor_tolerance:
            self.alarm, self.alarm_at = "common_mode_noise_or_environment_shift", n
        return self.alarm


def guarded_promotion_decision(statistical_status: str, *, independent_validation_pass: bool,
                               adversarial_checks_pass: bool, regression_pass: bool,
                               rollback_available: bool) -> dict:
    """M17-compatible adapter; eligibility never mutates productive SkillMemory."""
    gates = {
        "independent_validation": bool(independent_validation_pass),
        "adversarial_checks": bool(adversarial_checks_pass),
        "locked_regression": bool(regression_pass),
        "rollback_available": bool(rollback_available),
    }
    if statistical_status != "accept_candidate":
        return {"status": "quarantine_or_abstain", "eligible_for_promotion": False,
                "productive_memory_mutated": False, "failed_gates": ["sequential_evidence"], "gates": gates}
    failed = [name for name, passed in gates.items() if not passed]
    if failed:
        return {"status": "quarantine", "eligible_for_promotion": False,
                "productive_memory_mutated": False, "failed_gates": failed, "gates": gates}
    return {"status": "eligible_pending_existing_promotion_transaction", "eligible_for_promotion": True,
            "productive_memory_mutated": False, "failed_gates": [], "gates": gates}
