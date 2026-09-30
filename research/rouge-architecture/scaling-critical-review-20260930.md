# Rouge: critical review of scalable efficiency mechanisms

Date: 2026-09-30. Branch: `rouge/free-gpu-training-20260930`.
Two research agents searched official compute sources and primary papers; the main agent checked the decisive provider restrictions and executed the registered R1.73a format audit. No cloud training instance was provisioned.

## Completed falsification test

R1.73a, registration committed locally at `9c3e82b` before measurement: 1,623,744-parameter untrained ternary fixture, seeds 1/2/3, registered enwik8 validation bytes, existing Rouge gate/statistics harness. Three exporter tests passed.

All four format gates passed in every seed. Physical master file: 6,509,069 bytes; packed file: 2,087,589 bytes (32.072% of master, 67.928% reduction). Ternary codes round-trip exactly; maximum logit error 1.1921e-6, below the registered 1e-5 tolerance. Largest absolute BPB delta 1.3759e-6, below 1e-5.

Descriptive unfused CPU decode: baseline mean 219.8 tokens/s, packed reference 202.3 tokens/s. This execution expands projections to floating-point tensors. There is no demonstrated speed improvement, no learned-quality result, no GPU training result, and no iPad energy result. Raw per-seed results and report are under `results/r1.73a/`; checkpoint hashes are recorded there.

## Mechanisms that merit larger-scale tests

| Mechanism | External demonstration | Rouge evidence / counterevidence | Next decision |
| --- | --- | --- | --- |
| Verified rule-dense curricula | Phi-1 demonstrates domain-specific data efficiency at 1.3B; https://arxiv.org/abs/2306.11644 | No new Rouge result for curriculum quality in this turn. Teacher-generated data has a cost; deterministic executable generators avoid that particular dependency. | Use the existing R1.54/R1.55/R1.65 curriculum registration. Keep real-text BPB and longer-instance generalisation separate. |
| Native ternary weights and specialized kernels | BitNet 2B4T demonstrates a 2B ternary model trained on 4 trillion tokens; https://arxiv.org/abs/2504.12285 | R1.29b passed its mean gates provisionally; seed uncertainty remains. R1.73a now validates physical serialization only. | Trained-checkpoint quality and fused-kernel measurements must follow. Packing does not eliminate data or optimization costs. |
| MatMul-free token mixer | Language-model experiments up to 2.7B; https://arxiv.org/abs/2406.02528 | Rouge ternary FFNs still coexist with attention matmuls. Published savings cannot be assigned to this implementation. | Separate token-mixer ablation at equal tokens and measured compute; BPB, retrieval/passkey and wall-clock gates. |
| Sparse expert dispatch | Existing Rouge R1.22 executed sparse CPU dispatch | 3.3x against equal-total-parameter dense MLP, but 1.18x its equal-active-compute dense comparator's time. One layer, CPU only. | Benchmark executed GPU dispatch and full-model quality; no automatic 3.3x training claim. |
| Structured matrices | Monarch reports GPT-2/BERT experiments; https://arxiv.org/abs/2204.00595 | R1.26/R1.27 improvements within seed noise; shared basis did not meet the required improvement. | Retain candidate E in the registered tournament; reject if quality/cost gates fail. |

No cited paper or current Rouge result supports frontier equivalence from zero-cost training, unlimited knowledge compression, or instant pretraining. A new architecture must beat a held-out comparator at measured cost before promotion. Negative outcomes remain in the record.

## Promotion order and blockers

1. Preserve all R rejection lessons; do not revive reward-only RL from scratch, latent programs or verifier heads without a registered material change.
2. Finish the registered Level B baseline and candidates. The local measurement snapshot's checked-in decision is incomplete: baseline A missing or disqualified.
3. Run Level C with all registered seeds; freeze architecture only after a valid winner.
4. Scale the winning architecture; derive size and token budget from measured throughput and the confirmed free allocation. Hardware availability alone is not a promotion gate.

Provider corrections from official pages:

- Daytona pricing advertises USD 200 free compute, but billing docs explicitly exclude GPU sandboxes from free credit balance: https://www.daytona.io/docs/billing . Disqualified for zero-cash GPU training.
- razorBridge and Wollnut terms require age 18: https://razorbridge.eu/terms-of-service/ and https://www.wollnut.com/terms . Registration cannot proceed under an ineligible identity. An eligible account owner would need to perform their own registration and authorize access; none is assumed.
- A free account or GPU catalog is not evidence of usable credits or an allocation. No verified free B200 session has been obtained.
- Publication succeeded through the GitHub connector. Remote branch starts from Claude's then-current `1277feaf` commit. Measurement provenance remains local `9c3e82b`, based on `05073f8`. No main or workflow changes were made.
- Advisory weight-storage preflight (`training/rouge/resource_gate.py`) rejects resident models whose ideal weight bytes alone exceed device memory. Three tests pass; this check does not confirm training fit. At 4 bits, 2T/3T total parameters require at least 1.0/1.5 trillion bytes for weights alone.
- Current execution environment has neither Lightning API key environment variable set. Existing repository probe (17:24:57 UTC) records 1.27 credits and no recurring free grant; this is historical, not a live balance. Browser login currently asks for human verification. No new Lightning job has been submitted.
