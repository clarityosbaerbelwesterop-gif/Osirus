"""Rouge 1 training layer (M58).

Rouge 1 is one model lineage: a derivative of Qwen3.5-397B-A17B with its own
trained checkpoints. This package holds what must be exact and reproducible
around that lineage -- the pinned base, checkpoint manifests, the dataset
registry and seed control. Training itself runs on GPU infrastructure (see
docs/rouge/compute-plan.md); weights never enter this repository.
"""

__all__ = ["checkpoints", "manifest", "registry", "seeds"]
