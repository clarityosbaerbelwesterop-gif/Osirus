"""Kernel benchmarks on the current device: speed claims come only from here.

Times forward+backward (training) and forward (inference) of one FFN-sized projection
for: dense bf16 (nn.Linear), ternary with fake quantisation (BitLinear, the training
path), ternary packed 2-bit then unpacked on the fly (a naive inference path), int8
fake-quant, Monarch (4 blocks), and an MoE layer against a dense FFN of equal active
FLOPs. No custom low-bit kernel exists yet, so packed ternary is expected to be slower
than dense: the number is recorded, not assumed away.

    python -m native.bench [--tokens 8192 --d 1024]
"""

from __future__ import annotations

import argparse
import json
import time

import torch

from .config import RougeConfig
from .layers import BitLinear, Int8Linear, MonarchLinear, pack_ternary, quantize_ternary, unpack_ternary
from .model import MoE, SwiGLU


def timed(fn, device, reps: int = 20) -> float:
    for _ in range(3):
        fn()
    if device.type == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    for _ in range(reps):
        fn()
    if device.type == "cuda":
        torch.cuda.synchronize()
    return (time.perf_counter() - t0) / reps * 1e3


def run(tokens: int, d: int, device: torch.device) -> dict:
    # the training precision on this GPU: bf16 where native (capability >= 8.0), fp16 otherwise (T4)
    dtype = (torch.bfloat16 if torch.cuda.get_device_capability()[0] >= 8 else torch.float16) if device.type == "cuda" else torch.float32
    hidden = 4 * d
    x = torch.randn(tokens, d, device=device, dtype=dtype, requires_grad=True)
    layers = {"dense": torch.nn.Linear(d, hidden, bias=False), "ternary_fakequant": BitLinear(d, hidden),
              "int8_fakequant": Int8Linear(d, hidden), "monarch4": MonarchLinear(d, hidden, 4)}
    out = {"device": str(device), "gpu": torch.cuda.get_device_name() if device.type == "cuda" else None,
           "dtype": str(dtype), "tokens": tokens, "d": d, "hidden": hidden, "ms": {}}
    for name, layer in layers.items():
        layer = layer.to(device)
        ctx = torch.autocast(device.type, dtype=dtype) if device.type == "cuda" else torch.autocast("cpu", enabled=False)

        def train_step():
            with ctx:
                layer(x).float().sum().backward()

        def infer():
            with torch.no_grad(), ctx:
                layer(x)

        out["ms"][name] = {"train": round(timed(train_step, device), 3), "infer": round(timed(infer, device), 3)}
    # packed ternary inference: unpack 2-bit codes, scale, matmul (no fused kernel)
    w = layers["ternary_fakequant"].weight
    q, scale = quantize_ternary(w)
    packed = pack_ternary(q.cpu()).to(device)

    def packed_infer():
        with torch.no_grad():
            wq = unpack_ternary(packed, w.numel()).view_as(w).to(dtype) * scale.to(dtype)
            x.detach() @ wq.T

    out["ms"]["ternary_packed_unfused"] = {"infer": round(timed(packed_infer, device), 3)}
    # sparse FFN vs dense FFN at equal active FLOPs
    cfg = RougeConfig(d_model=d, n_heads=max(2, d // 64), n_kv_heads=max(2, d // 64), moe_experts=8, moe_topk=2)
    dense_cfg = RougeConfig(d_model=d, n_heads=max(2, d // 64), n_kv_heads=max(2, d // 64))
    for name, mod in (("ffn_dense", SwiGLU(dense_cfg, dense_cfg.hidden)), ("ffn_moe8_top2", MoE(cfg))):
        mod = mod.to(device)
        xx = x.detach()[None]
        ctx = torch.autocast(device.type, dtype=dtype) if device.type == "cuda" else torch.autocast("cpu", enabled=False)

        def step(mod=mod, xx=xx, ctx=ctx):
            with ctx:
                mod(xx).float().sum().backward()

        out["ms"][name] = {"train": round(timed(step, device, reps=10), 3)}
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tokens", type=int, default=8192)
    parser.add_argument("--d", type=int, default=1024)
    args = parser.parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("ROUGE_BENCH " + json.dumps(run(args.tokens, args.d, device)))


if __name__ == "__main__":
    main()
