# Reasoning post-training (M60)

**Tasks.** Verified tasks whose rewards are computed, never judged by the
model itself:

- math;
- logic;
- code (executed in a sandbox);
- program execution;
- constraint satisfaction.

**Sources.** The M57 generators provide these on a separate train seed
namespace. A contamination check against the dev and holdout namespaces
runs before every data build.

**Methods.** Rejection sampling, SFT on verified traces, DPO, and GRPO
where justified.

**Output:** `rouge-1-reasoning-NNN`.
