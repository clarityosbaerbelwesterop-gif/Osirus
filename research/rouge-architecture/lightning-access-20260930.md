# Existing-secret Lightning access check

Checked 2026-09-30 18:56 UTC (20:56 Europe/Berlin).
Run: https://github.com/clarityosbaerbelwesterop-gif/Osirus/actions/runs/36762099171
Code commit: 8cd37d89c365e2a99d2d95d84dbf6646fc31d76d
Result: success; GitHub Actions authenticated using repository secret LIGHTNING_AI_API_KEY.

The isolated workflow calls the existing launcher with probe --out only.
No Lightning job or Studio was created or stopped; no model or storage upload occurred.
The key remained a masked environment variable in Actions.

## Observations

- Four membership records represent two project names, each seen through organization and user membership; these are not four independent balances.
- default-project access was refused.
- Rouge - access was readable; launcher reported one usable teamspace.
- Balance read: approximately USD 1.27 (user membership reports 1.268422222222246).
- free_credits_enabled: false; next_free_credits_grant: null on all returned membership records.
- ProjectAdministrator role appeared for readable entries. Job creation permission and actual capacity were not tested.
- Machine catalog: T4_SMALL USD 0.55/h; T4 USD 0.69/h; L4 USD 0.79/h; H200 USD 4.50/h; B200 USD 9.86/h on demand.
- Catalog listings do not prove that a GPU can presently be allocated.
- Studios were not enumerated by the existing probe.

## Training implication

Authentication is working; browser verification is not required for this API path.
The API did not confirm free multi-hour GPU training after credit exhaustion.
At USD 0.79/h, 50 hours of L4 alone would cost USD 39.50 before storage or other costs, far above the observed credit balance.
No training was started from this access check, and no remaining shared credits were spent.
A training launch requires a concrete fitting model, validated data/evaluation and a zero-cash resource budget that does not interfere with other work.

The separate workflow and this report are confined to rouge/free-gpu-training-20260930.
