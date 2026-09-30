# R1.73a: PASS (CPU format gate only)

Three untrained native C fixtures. No pretraining, learned-quality, iPad, joule or fused-kernel claim.

| Metric | Mean | Sample SD | 95% Student-t CI |
|---|---:|---:|---|
| packed-format:packed_to_master_file_ratio | 0.32072006 | 0 | [0.32072006, 0.32072006] |
| packed-format:max_logit_error | 1.1920929e-06 | 0 | [1.1920929e-06, 1.1920929e-06] |
| packed-format:max_abs_bpb_delta | 9.172408e-07 | 3.9717692e-07 | [-6.9480991e-08, 1.9039626e-06] |
| packed-format:code_roundtrip_exact | 1 | 0 | [1, 1] |
| packed-format:packed_file_bytes | 2087589 | 0 | [2087589, 2087589] |
| packed-format:master_file_bytes | 6509069 | 0 | [6509069, 6509069] |
| packed-format:tensor_payload_bytes | 2071344 | 0 | [2071344, 2071344] |
| packed-format:fakequant_tokens_s | 219.83333 | 21.179786 | [167.21558, 272.45108] |
| packed-format:packed_tokens_s | 202.26667 | 13.659185 | [168.33263, 236.2007] |
| packed-format:export_load_s | 0.032303314 | 0.0018258461 | [0.027767295, 0.036839334] |

Checks: `{"complete": true, "checks": {"bytes": true, "logits": true, "loss": true, "codes": true}, "result": "PASS"}`.

The packed reference expands each projection into a dense tensor during execution. File bytes are physical; runtime savings require a fused backend.
The RSS measurement includes both models and all audit work. Checkpoints remain artifacts; SHA-256 hashes are in the seed records.
