"""Rouge native model (Rouge Architecture v1): configuration, model, training.

Separate from `rouge_train` (the M58 LoRA path on a pinned base model); it
reuses that package's hashing, seeding and checkpoint-manifest modules.
"""

from .config import RougeConfig
from .model import RougeModel

__all__ = ["RougeConfig", "RougeModel"]
