# R1.30 result: PASS (definitions complete)

The definitions are in `docs/rouge/research/capacity-accounting.md`:
- **Physical capacity:** stored bytes, with packed low-bit weights and shared banks counted once.
- **Active capacity:** parameters and *executed* FLOPs per token.
- **Virtual (addressable) capacity:** the space of selectable or generated computations, reported in bits or dimensions. It is never counted as parameters.

The definitions include a worked example (R1.04: 606k physical, 208k active, about 19 bits of expert-path choice per token) and a list of forbidden claims.

**Implemented:**
- `stored_bytes()` for structured models;
- `active_parameters()` for MoE;
- executed FLOPs and state/KV bytes in every scorecard.

No compute was needed. Cost: $0.
