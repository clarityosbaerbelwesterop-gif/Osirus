# R1.05 result: PASS (literature map complete)

The literature map is `docs/rouge/research/prior-art.md`. It covers:

- architecture families: Transformers, Universal Transformer, ACT, PonderNet, recurrent depth, HRM and TRM, looped Transformers, SSMs (S4, Mamba, Mamba-2), RWKV and RetNet;
- hybrids and memory: window-plus-state hybrids, memory-augmented Transformers, Titans and TTT, slot and latent arrays, NTM, DNC and Memory Networks, fast weights;
- conditional and generated parameters: MoE, Switch, expert choice, Mixture of Depths, early exit, HyperNetworks, parameter sharing, structured matrices (TT, Kronecker, Monarch, LoRA), implicit representations, BitNet;
- programs, models of the world and learning rules: neural program execution, latent reasoning, world models, energy-based models, predictive coding, Forward-Forward, verifiers, active selection.

Each Rouge idea is placed against prior art: what exists, what is similar, what is different and what is untested.

**Conclusion:** no Rouge mechanism is novel on its own. A contribution can only be a measured combination, or a measurement that others did not report. Cost: $0, no compute.
