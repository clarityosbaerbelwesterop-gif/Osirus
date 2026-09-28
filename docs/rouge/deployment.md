# Rouge 1 — deployment: Rouge Full, Rouge Edge, Rouge Server

One model lineage, two deployment targets. Every deployed artifact is a
checkpoint of the Rouge lineage (or a quantisation of one) with a manifest.
None is another foundation model.

```
rouge-1-<stage>-NNN (BF16, canonical)
 ├─ Rouge Full   → Rouge Server (vLLM / SGLang, OpenAI-compatible), GPU
 └─ Rouge Edge   → GGUF Q8_0 … Q4_K_M … IQ2 → llama.cpp (Metal / CPU / CUDA)
                   → Mac, and iPad/iPhone only where memory allows
```

## What is proven and what is calculated

Evidence:

- CI run `36469389709` (commit `07eee3c`):
  - **Linux:** checkpoint 4/4; F16, Q8_0, Q6_K, Q5_K_M and Q4_K_M each 4/4
    through llama-server. KL divergence against F16: Q8_0 0.0003, Q4_K_M
    0.0025.
  - **macos-14 (Metal):** F16 scores like the checkpoint.
  - **iOS:** `libllama.a` built for arm64 with Metal (5.6 MB).
- These are tiny-model numbers. Its 248k-token embedding dominates the
  file size, so its bits per weight say nothing about the 27B.

| Claim                                                                                                                                  | Status                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| llama.cpp converts the Qwen3.5 architecture (`Qwen3_5ForConditionalGeneration` → `qwen35`, MTP head exported for speculative decoding) | **Verified** in the pinned llama.cpp (`f1ea206`)                                              |
| Rouge checkpoint → F16 GGUF gives the same eval score as the checkpoint itself                                                         | **Tested** in CI on the smoke model (`rouge-edge.yml`, Linux, and Metal on Apple silicon)     |
| Q8_0 / Q6_K / Q5_K_M / Q4_K_M: size, speed, KL divergence vs F16, eval score through llama-server                                      | **Measured** in CI on the smoke model; the tiny model's numbers are not the 27B's             |
| llama.cpp libraries build for iOS (arm64, Metal)                                                                                       | **Compile-tested** in CI (`macos-14`); not run on a device                                    |
| 27B sizes, memory and speeds below                                                                                                     | **Calculated** (`training/rouge/scripts/size_edge.py`); to be measured on the real checkpoint |

## Rouge Edge: the full 27B, quantised

**Exact inputs.**

- Text-model parameters: 26,895,998,464 (the vision tower is a separate
  `mmproj` file of about 0.9 GB).
- KV cache: only 16 of the 64 layers use attention, so it costs 64 KiB per
  token (0.5 GB at 8k, 2.1 GB at 32k).
- The 48 Gated DeltaNet layers keep a fixed state of 157 MB.

This makes long context unusually cheap on devices.

| Quantisation | Bits/weight (typical) | File    | RAM at 8k | RAM at 32k |
| ------------ | --------------------- | ------- | --------- | ---------- |
| BF16         | 16                    | 53.8 GB | 55.3 GB   | 56.9 GB    |
| Q8_0         | 8.5                   | 28.6 GB | 30.1 GB   | 31.7 GB    |
| Q6_K         | 6.56                  | 22.1 GB | 23.5 GB   | 25.2 GB    |
| Q5_K_M       | 5.69                  | 19.1 GB | 20.6 GB   | 22.2 GB    |
| **Q4_K_M**   | 4.85                  | 16.3 GB | 17.8 GB   | 19.4 GB    |
| Q3_K_M       | 3.91                  | 13.1 GB | 14.6 GB   | 16.2 GB    |
| IQ3_XXS      | 3.21                  | 10.8 GB | 12.3 GB   | 13.9 GB    |
| IQ2_M        | 2.93                  | 9.9 GB  | 11.3 GB   | 13.0 GB    |

**Devices.**

- The best-quality variant that fits the GPU memory the OS allows (macOS:
  about ⅔–¾ of RAM).
- Decode speed is estimated as memory bandwidth × 0.65 ÷ model size. It is
  an estimate, not a measurement.

| Device (RAM)                 | Fits                      | Decode estimate |
| ---------------------------- | ------------------------- | --------------- |
| Mac M4 Max (36 GB)           | Q6_K                      | ~16 tokens/s    |
| Mac M4 Max (48–128 GB)       | Q8_0 (BF16 from 128 GB)   | ~12 tokens/s    |
| Mac M4 Pro (24 GB)           | Q3_K_M                    | ~13 tokens/s    |
| Mac M4 Pro (48–64 GB)        | Q8_0                      | ~6 tokens/s     |
| Mac M4 (24 GB / 32 GB)       | Q3_K_M / Q5_K_M           | ~4–6 tokens/s   |
| Mac M4 (16 GB)               | **does not fit**          | —               |
| Mac Studio M3 Ultra (96 GB+) | BF16 (unquantised)        | ~10 tokens/s    |
| iPad Pro M4 (16 GB)          | **does not fit reliably** | —               |
| iPhone Pro (8–12 GB)         | **does not fit**          | —               |

**Conclusions.**

- **Full 27B Rouge Edge is a Mac product:** 24 GB and up, Q4_K_M as the
  default at 32 GB and up.
- **It is not an iPhone product.** Even the 2.9-bit variant needs about 11
  GB, more than an iOS app may use on any current iPhone.
- **Rouge Edge Mobile needs a smaller model derived from Rouge.** The path
  is structured pruning of Rouge's own weights plus distillation from Rouge
  Full. It gets its own `rouge-1-edge-NNN` manifest, and its size is
  decided from measured device limits after the first training PASS. It is
  not built before Rouge Full has beaten its base.
- **Quality loss is measured, not assumed.** `rouge_train.edge` reports mean
  KL divergence and top-token agreement against F16, and the eval score of
  each variant. A variant ships only if its eval score stays within an
  agreed margin of the checkpoint.

## Measuring on a real device (free)

On a Mac with enough memory, with llama.cpp built (Metal is the default on
macOS):

```sh
python -m rouge_train.edge --model <merged checkpoint or dir of model-*.gguf> \
  --llama <llama.cpp> --items <eval.jsonl> --out edge-report --ngl 99
```

The report contains, for every variant:

- file size and bits per weight;
- prompt and generation tokens/s (llama-bench, Metal);
- KL divergence and top-token agreement against F16;
- the eval score through llama-server.

## iOS and macOS apps

- The llama.cpp libraries build for iOS arm64 with Metal (CI).
- An app embeds them (static `libllama` or the xcframework from
  `build-xcframework.sh`) and loads a Rouge Edge GGUF.
- On iOS it needs the increased-memory-limit entitlement.
- On macOS the same GGUF runs in `llama-server` as a local OpenAI-compatible
  endpoint (below), so Osirus can use a local Rouge without code changes.

## Rouge Server

`training/rouge/serve/rouge-server.sh`:

- **`full <checkpoint>`:** vLLM, BF16 on a GPU, OpenAI-compatible, served
  model name `rouge-1`, reasoning parser for Qwen3-style thinking, prefix
  caching.
- **`edge <file.gguf>`:** llama.cpp `llama-server` with the model's own chat
  template (`--jinja`), for a Mac or any CPU/GPU box.

Security:

- An API key is mandatory.
- The server binds to 127.0.0.1 unless `HOST` is set.
- Put TLS and access control in front before exposing it.

The server runs on our own hardware or on a temporarily rented GPU; there
is no permanent datacenter. Both variants are scored by the same harness as
training (`generate --backend openai`), so server output is measured, not
assumed.
