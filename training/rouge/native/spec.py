"""Analytic compute and memory for a Rouge configuration (the v1 spec calculator).

All counts are per token unless stated. FLOPs count a multiply-add as 2.
Attention scores and values cost 2 * 2 * d_head * n_heads * context per
token for a query attending to `context` keys: full layers attend to half
the sequence on average (causal), local layers to min(window, seq / 2).
Training FLOPs = 3 x forward (backward is about twice the forward).
Checked against measured parameter counts and PyTorch's FLOP counter on
small configurations (tests/test_native_train.py).
"""

from __future__ import annotations

from .config import RougeConfig


def _linear_params(cfg: RougeConfig, n_in: int, n_out: int) -> int:
    if cfg.structured == "monarch" and n_in % cfg.structured_blocks == 0 and n_out % cfg.structured_blocks == 0:
        b = cfg.structured_blocks
        return n_in * (n_out // b) + n_out * b
    return n_in * n_out


def layer_params(cfg: RougeConfig) -> dict:
    d, hd = cfg.d_model, cfg.head_dim
    attn = (_linear_params(cfg, d, cfg.n_heads * hd) + 2 * _linear_params(cfg, d, cfg.n_kv_heads * hd)
            + _linear_params(cfg, cfg.n_heads * hd, d))

    def swiglu(h):
        return 2 * _linear_params(cfg, d, h) + _linear_params(cfg, h, d)

    if cfg.moe_experts:
        shared_h = max(cfg.expert_hidden, cfg.hidden - cfg.moe_topk * cfg.expert_hidden) // max(1, cfg.moe_shared)
        expert = swiglu(cfg.expert_hidden)
        shared = cfg.moe_shared * swiglu(shared_h)
        ffn_total = cfg.moe_experts * expert + shared + d * cfg.moe_experts
        ffn_active = cfg.moe_topk * expert + shared + d * cfg.moe_experts
    else:
        ffn_total = ffn_active = swiglu(cfg.hidden)
    return {"attn": attn, "ffn_total": ffn_total, "ffn_active": ffn_active, "norms": 2 * d}


def summary(cfg: RougeConfig, seq: int | None = None, tokens: float = 0.0, dtype_bytes: int = 2) -> dict:
    seq = seq or cfg.max_seq
    lp = layer_params(cfg)
    emb = cfg.vocab_size * cfg.d_model
    head = 0 if cfg.tie_embeddings else emb
    physical = cfg.n_layers * (lp["attn"] + lp["ffn_total"] + lp["norms"]) + emb + head + cfg.d_model
    active_matmul = cfg.n_layers * (lp["attn"] + lp["ffn_active"]) + cfg.vocab_size * cfg.d_model  # head matmul
    n_global = sum(cfg.is_global(i) for i in range(cfg.n_layers))
    n_local = cfg.n_layers - n_global
    ctx_full, ctx_local = seq / 2, min(cfg.window, seq / 2)
    attn_flops = 4 * cfg.n_heads * cfg.head_dim * (n_global * ctx_full + n_local * ctx_local)
    fwd = 2 * active_matmul + attn_flops

    lowbit_params = 0
    if cfg.lowbit == "ternary":
        ffn_part = cfg.n_layers * lp["ffn_total"] - (cfg.n_layers * cfg.d_model * cfg.moe_experts if cfg.moe_experts else 0)
        lowbit_params = ffn_part + (cfg.n_layers * lp["attn"] if cfg.lowbit_scope == "all" else 0)
    stored = (physical - lowbit_params) * dtype_bytes + lowbit_params / 4

    kv_per_token_layer = 2 * cfg.n_kv_heads * cfg.head_dim * dtype_bytes

    def kv(context):
        return kv_per_token_layer * (n_global * context + n_local * min(context, cfg.window))

    # activation memory per token and layer for training (bf16), rough: residual, norms, qkv, attention out, ffn
    act_per_token_layer = dtype_bytes * (6 * cfg.d_model + 4 * (cfg.hidden if not cfg.moe_experts else cfg.moe_topk * cfg.expert_hidden))
    return {
        "architecture_sha": cfg.architecture_sha,
        "params_physical": int(physical), "params_active_matmul": int(active_matmul),
        "stored_bytes": int(stored), "lowbit_params": int(lowbit_params),
        "flops_per_token_matmul": float(2 * active_matmul), "flops_per_token_attention": float(attn_flops),
        "flops_per_token_forward": float(fwd), "flops_per_token_train": float(3 * fwd),
        "train_flops": float(3 * fwd * tokens) if tokens else None,
        "kv_bytes": {"4k": kv(4096), "32k": kv(32768), "128k": kv(131072), "1m": kv(1 << 20)},
        "activation_bytes_per_token": {"full": int(act_per_token_layer * cfg.n_layers),
                                        "checkpointed": int(dtype_bytes * cfg.d_model * cfg.n_layers)},
        # memory traffic to generate one token at batch 1: all active weights once, plus the KV cache read
        "decode_bytes_per_token_4k": int(stored if not cfg.moe_experts else stored * active_matmul / max(1, physical)) + kv(4096),
        "global_layers": n_global, "local_layers": n_local,
    }
