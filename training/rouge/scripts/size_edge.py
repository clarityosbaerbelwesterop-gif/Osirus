#!/usr/bin/env python3
"""Rouge Edge sizing for the full 27B lineage (calculated, not measured).

File size per GGUF quantisation, memory at a given context length, and a
bandwidth-bound decode-speed estimate per Apple device class. Inputs are
exact where possible:

- text-model parameters: counted on the meta device (scripts/size_qlora.py):
  27,356,728,560 loaded minus 460,730,096 in the vision tower;
- KV cache and recurrent state: from the pinned config (16 attention layers
  with 4 KV heads of 256; 48 Gated DeltaNet layers with 48 value heads of
  128 x 128 state);
- bits per weight: typical whole-model llama.cpp averages; the real value is
  measured by rouge_train.edge on the real checkpoint.

Decode speed is modelled as memory bandwidth x efficiency / bytes read per
token (the whole quantised model for a dense model). It is an estimate to
be replaced by llama-bench on the device.

    python training/rouge/scripts/size_edge.py
"""

from __future__ import annotations

import json
from pathlib import Path

BASE = json.loads((Path(__file__).resolve().parents[3] / "models" / "rouge-1" / "base.json").read_text())
TEXT_PARAMS = 27_356_728_560 - 460_730_096
BPW = {"BF16": 16.0, "Q8_0": 8.5, "Q6_K": 6.56, "Q5_K_M": 5.69, "Q4_K_M": 4.85, "Q3_K_M": 3.91, "IQ3_XXS": 3.21, "IQ2_M": 2.93}
EFFICIENCY = 0.65
BUFFERS_GB = 0.8  # llama.cpp compute buffers, graph, runtime (typical)
# Unified-memory devices: (bandwidth GB/s, RAM GB options, share of RAM the
# GPU/app may use by default). macOS lets the GPU wire about 2/3-3/4 of RAM;
# iOS/iPadOS apps get far less, even with the increased-memory entitlement.
DEVICES = {
    "Mac M4 Max": (546, (36, 48, 64, 128), 0.75),
    "Mac M4 Pro": (273, (24, 48, 64), 0.70),
    "Mac M4": (120, (16, 24, 32), 0.66),
    "Mac Studio M3 Ultra": (819, (96, 256, 512), 0.75),
    "iPad Pro M4 (16 GB)": (120, (16,), 0.50),
    "iPhone Pro (8-12 GB)": (60, (8, 12), 0.45),
}


def state_bytes(context: int) -> tuple[int, int]:
    text = BASE["config"]["text_config"]
    attention_layers = text["num_hidden_layers"] // text["full_attention_interval"]
    linear_layers = text["num_hidden_layers"] - attention_layers
    kv_per_token = attention_layers * 2 * text["num_key_value_heads"] * text["head_dim"] * 2  # K and V, f16
    conv_dim = 2 * text["linear_num_key_heads"] * text["linear_key_head_dim"] + text["linear_num_value_heads"] * text["linear_value_head_dim"]
    recurrent = linear_layers * (
        text["linear_num_value_heads"] * text["linear_key_head_dim"] * text["linear_value_head_dim"] * 4
        + (text["linear_conv_kernel_dim"] - 1) * conv_dim * 4
    )
    return kv_per_token * context, recurrent


def main() -> None:
    rows = []
    for quant, bpw in BPW.items():
        file_gb = TEXT_PARAMS * bpw / 8 / 1e9
        row = {"quant": quant, "bits_per_weight": bpw, "file_gb": round(file_gb, 1)}
        for context in (8192, 32768):
            kv, recurrent = state_bytes(context)
            row[f"ram_gb_{context // 1024}k"] = round(file_gb + (kv + recurrent) / 1e9 + BUFFERS_GB, 1)
        rows.append(row)
    devices = {}
    for device, (bandwidth, rams, usable) in DEVICES.items():
        fits = {}
        for ram in rams:
            budget = ram * usable
            fitting = [r for r in rows if r["ram_gb_8k"] <= budget]
            best = fitting[0] if fitting else None
            fits[f"{ram} GB"] = (
                {"best_quant": best["quant"], "ram_gb_8k": best["ram_gb_8k"],
                 "decode_tokens_per_s_estimate": round(bandwidth * EFFICIENCY / best["file_gb"], 1)}
                if best else "does not fit"
            )
        devices[device] = {"bandwidth_gb_s": bandwidth, "usable_share": usable, "by_ram": fits}
    kv8, recurrent = state_bytes(8192)
    print(json.dumps({
        "text_parameters": TEXT_PARAMS,
        "kv_cache_bytes_per_token": kv8 // 8192,
        "recurrent_state_bytes": recurrent,
        "quantisations": rows,
        "devices": devices,
        "note": "calculated; replace with rouge_train.edge / llama-bench measurements on the real checkpoint and device",
    }, indent=1))


if __name__ == "__main__":
    main()
