# Multimodal (M66)

**Goal:** preserve and improve the base's native early-fusion vision:
images, screenshots, charts, documents, UI and diagrams.

**Constraints:**

- One Rouge model, with no separate vision model bolted on.
- The vision encoder stays frozen in `rouge-1-sft-001`.
- Every text-only stage is guarded by multimodal regression suites.
