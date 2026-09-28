"""One seed controls every source of randomness in a run."""

from __future__ import annotations

import os
import random


def seed_everything(seed: int, *, deterministic: bool = True) -> dict:
    """Seed Python, NumPy and PyTorch when present; returns what was seeded."""
    seeded = {"python": seed}
    random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    try:
        import numpy as np  # type: ignore

        np.random.seed(seed)
        seeded["numpy"] = seed
    except ImportError:
        pass
    try:
        import torch  # type: ignore

        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
        if deterministic:
            # cuBLAS needs this for deterministic GEMMs; some MoE kernels have
            # no deterministic variant, so warn rather than fail.
            os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
            torch.use_deterministic_algorithms(True, warn_only=True)
        seeded["torch"] = seed
    except ImportError:
        pass
    return seeded
