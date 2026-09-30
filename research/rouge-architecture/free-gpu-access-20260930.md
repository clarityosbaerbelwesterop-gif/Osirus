# Free GPU access gate — 2026-09-30

Branch: `rouge/free-gpu-training-20260930`, based on `05073f8`.
The existing worktree and its untracked research files are preserved separately.

## Owner constraints

- Cash spending limit: EUR 0. No payment card, IBAN, top-up or paid subscription.
- No CPU training. Prefer B200; investigate H200 as the available alternative.
- No use of the assistant's serving infrastructure: it is not available as a training resource.
- Retain Rouge's registered experiments and scale gates. Access to a faster GPU does not justify bypassing the tournament or claiming frontier equivalence.

## Public evidence (account access is not established)

| Provider | Published offer | Limitation | Source |
| --- | --- | --- | --- |
| razorBridge | EUR 10 starting credit, no credit card; H200 141 GB at EUR 4.49/hour | Signup requires email, a new password and terms acceptance. Inventory, granted credit, other charges and debt policy must be verified. Documentation says machines continue briefly after credits run out. | https://razorbridge.eu/pricing/ |
| VoltageGPU | USD 5 referral credit without a card; H200 at USD 6.58/hour for listed containers | Referral eligibility and actual account balance unknown. Page explicitly says B200 has never been available to date. Published hours are inconsistent: USD 5 at USD 5/hour is one H100 hour, not two. | https://voltagegpu.com/pricing |
| Lightning AI | Free tier without a card; published A100 introductory hours | H200 free hours not listed; full-node B200 listed under Enterprise. Existing project access was previously limited. | https://lightning.ai/pricing |
| Nebius | Research grants for eligible institutional researchers | Application and selection, not immediate self-service compute. Do not invent institutional affiliation. | https://nebius.com/nebius-research-grants |

For razorBridge, EUR 10 / EUR 4.49 per hour = 2.227 hours before any other charges.
This is arithmetic from public pricing, not an account entitlement or a runtime measurement.
No verified carrier-billing option was found in the reviewed offers. Carrier billing would still be spending and needs a separate owner budget.

## Launch checklist

- [x] Create isolated branch and preserve original worktree.
- [x] Verify published no-card H200 offer and inspect signup requirements.
- [ ] Complete account signup/login through the supported secure user flow.
- [ ] Verify granted free balance, available GPU, total instance/storage charges, minimum billing and mandatory reservations.
- [ ] Confirm no automatic top-up, cash charge or debt; confirm provider-side shutdown semantics. Local training deadlines alone do not stop instance billing.
- [ ] Reserve credit headroom for checkpoint upload and instance teardown; stop well before credit exhaustion.
- [ ] Confirm licensed corpus, tokenizer and train/validation provenance using existing Rouge data gates.
- [ ] Run the currently required registered tournament stage before choosing a billion-parameter architecture. Do not report an incomplete stage as PASS.
- [ ] Verify actual GPU using CUDA device identity and record software, commit, configuration, seed and data hashes.
- [ ] Run existing harness with bounded runtime, resumable checkpoints and held-out evaluation; export results before destroying ephemeral disk.
- [ ] Stop/release the instance and verify billing has stopped. Record credits consumed and cash cost separately.

## Current outcome

No GPU instance allocated and no new training job started. Account eligibility is also a blocker: razorBridge and Wollnut terms require age 18. Daytona free credits exclude GPU sandboxes. See `scaling-critical-review-20260930.md` for the completed R1.73a serialization audit and limits; no new learned-quality or frontier-equivalence claim is supported.
