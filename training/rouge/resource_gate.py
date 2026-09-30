"""Weight-storage lower bound before a Rouge base-model download.

This is an advisory preflight, not a measured training-memory estimator.
All MoE experts count even when only a subset is active. Passing this
check does not establish that training fits: caches, activations, scales,
gradients and optimizer state require additional measured memory.
"""
import argparse
import json
import math


def assess(parameters: int, bits: int, device_bytes: int) -> dict:
    if parameters <= 0 or bits not in (2, 4, 8, 16, 32) or device_bytes <= 0:
        raise ValueError("positive total parameters/memory and supported bit width required")
    weight_bytes = (parameters * bits + 7) // 8
    impossible_resident = weight_bytes > device_bytes
    return {
        "total_parameters": parameters,
        "weight_bits": bits,
        "weight_bytes_lower_bound": weight_bytes,
        "device_bytes": device_bytes,
        "status": "REJECT_SINGLE_DEVICE_RESIDENT" if impossible_resident else "NEEDS_MEASURED_DRY_RUN",
        "training_fit_confirmed": False,
        "scope": "ideal packed weights only, all experts; offload/distribution require separate measurements",
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--parameters", type=int, required=True, help="total, not active, parameters")
    p.add_argument("--bits", type=int, required=True)
    p.add_argument("--device-gb", type=float, required=True, help="decimal GB; use actual available bytes for launch")
    a = p.parse_args()
    if not math.isfinite(a.device_gb) or a.device_gb <= 0:
        p.error("device-gb must be finite and positive")
    result = assess(a.parameters, a.bits, int(a.device_gb * 1_000_000_000))
    print(json.dumps(result, indent=2))
    return 2 if result["status"] == "REJECT_SINGLE_DEVICE_RESIDENT" else 0


if __name__ == "__main__":
    raise SystemExit(main())
