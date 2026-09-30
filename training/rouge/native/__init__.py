"""Rouge native model (Rouge Architecture v1): configuration, model, training.

Separate from `rouge_train` (the M58 LoRA path on a pinned base model); it
reuses that package's hashing, seeding and checkpoint-manifest modules.
"""

from .config import RougeConfig

__all__ = ["RougeConfig", "RougeModel"]


def __getattr__(name):  # torch is imported only when the model is used (pareto and config work without it)
    if name == "RougeModel":
        from .model import RougeModel

        return RougeModel
    raise AttributeError(name)
