"""
H1 Candidate: Adaptive formation and revision of relationships.

Tracks simple conditional relations: P(success | color), P(success | size), and interactions.
Revises beliefs based on observations. Uses them for prediction on unseen.
Minimal implementation of relationship revision.
"""

from typing import Dict, List, Any
from collections import defaultdict

class H1Candidate:
    def __init__(self):
        # Track counts for conditions
        self.counts = defaultdict(lambda: {"success": 0, "total": 0})
        # Possible relations: color, size, color_and_size
        self.relations = ["color", "size", "color_size"]

    def _key(self, rel: str, obs: Dict) -> str:
        if rel == "color":
            return f"color={obs['color']}"
        elif rel == "size":
            return f"size={obs['size']}"
        elif rel == "color_size":
            return f"color={obs['color']}_size={obs['size']}"
        return "global"

    def update(self, obs: Dict, success: bool):
        for rel in self.relations:
            k = self._key(rel, obs)
            self.counts[k]["total"] += 1
            if success:
                self.counts[k]["success"] += 1

    def predict(self, obs: Dict) -> float:
        # Prefer most specific reliable relation
        scores = []
        for rel in ["color_size", "color", "size"]:
            k = self._key(rel, obs)
            data = self.counts[k]
            if data["total"] >= 2:  # min evidence
                p = data["success"] / data["total"]
                scores.append((p, data["total"], rel))
        if scores:
            # Choose highest confidence or most specific
            scores.sort(key=lambda x: (-x[1], -abs(x[0]-0.5)))  # more data, stronger signal
            return scores[0][0]
        return 0.5
