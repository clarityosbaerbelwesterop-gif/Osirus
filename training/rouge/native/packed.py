"""CPU reference export for native ternary C/D models.

Persist 2-bit FFN weights, scales, routing buffers and unquantised tensors.
Non-ternary tensors remain fp32 here, so the format audit isolates packing.
Inference unpacks each projection and calls F.linear: this is a portable
reference, not a fused kernel, GGUF, CoreML export or a speed claim.
"""

from __future__ import annotations

import json
from pathlib import Path

import torch
import torch.nn.functional as F
from torch import nn

from .config import RougeConfig
from .layers import BitLinear, Int8Linear, pack_ternary, quantize_ternary, unpack_ternary
from .model import RougeModel


class PackedLinear(nn.Module):
    def __init__(self, record: dict):
        super().__init__()
        self.shape = tuple(record["shape"])
        self.act_bits = record["act_bits"]
        self.register_buffer("packed", record["packed"])
        self.register_buffer("scale", record["scale"])
        self.register_buffer("bias", record.get("bias"))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        n = self.shape[0] * self.shape[1]
        w = unpack_ternary(self.packed, n).reshape(self.shape).to(x.dtype) * self.scale.to(x.dtype)
        if self.act_bits == 8:
            s = x.abs().amax(-1, keepdim=True).clamp_min(1e-5) / 127
            x = (x / s).round().clamp(-128, 127) * s
        return F.linear(x, w, None if self.bias is None else self.bias.to(x.dtype))


def save(model: RougeModel, path: str | Path) -> dict:
    cfg = model.cfg
    if cfg.lowbit != "ternary" or cfg.structured != "none":
        raise ValueError("reference export supports unstructured ternary C/D only")
    records, excluded = {}, set()
    with torch.no_grad():
        for name, module in model.named_modules():
            if isinstance(module, Int8Linear):
                raise ValueError("int8 projection is not ternary")
            if isinstance(module, BitLinear):
                q, scale = quantize_ternary(module.weight.detach().cpu().float())
                records[name] = {"shape": list(q.shape), "act_bits": module.act_bits,
                                 "packed": pack_ternary(q), "scale": scale,
                                 "bias": None if module.bias is None else module.bias.detach().cpu().float()}
                excluded.update(name + "." + k for k in ("weight", "bias"))
        state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items() if k not in excluded}
    if not records:
        raise ValueError("model contains no ternary projections")
    body = {"format": "rouge.packed-reference/1", "config": json.loads(cfg.to_json()),
            "architecture_sha": cfg.architecture_sha, "projections": records, "state": state}
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(body, path)
    payload = sum(t.numel() * t.element_size() for t in state.values())
    payload += sum(r["packed"].numel() + r["scale"].numel() * r["scale"].element_size()
                   + (0 if r["bias"] is None else r["bias"].numel() * r["bias"].element_size())
                   for r in records.values())
    return {"file_bytes": path.stat().st_size, "tensor_payload_bytes": payload,
            "projections": len(records), "architecture_sha": cfg.architecture_sha}


def load(path: str | Path) -> RougeModel:
    body = torch.load(path, map_location="cpu", weights_only=True)
    if body.get("format") != "rouge.packed-reference/1":
        raise ValueError("unknown packed format")
    cfg = RougeConfig(**body["config"])
    if cfg.architecture_sha != body["architecture_sha"]:
        raise ValueError("packed architecture hash does not match config")
    if cfg.lowbit != "ternary" or cfg.structured != "none":
        raise ValueError("unsupported packed architecture")
    model = RougeModel(cfg)
    expected = {name for name, m in model.named_modules() if isinstance(m, BitLinear)}
    if set(body["projections"]) != expected:
        raise ValueError("packed projection names do not match architecture")
    for name, record in body["projections"].items():
        old = model.get_submodule(name)
        if tuple(record["shape"]) != tuple(old.weight.shape) or record["act_bits"] != old.act_bits:
            raise ValueError("packed projection shape or activation precision mismatch")
        n = old.weight.numel()
        if record["packed"].dtype != torch.uint8 or record["packed"].numel() != (n + 3) // 4:
            raise ValueError("invalid packed projection size or dtype")
        codes = torch.stack([(record["packed"] >> s) & 3 for s in (0, 2, 4, 6)], 1).flatten()[:n]
        if (codes == 3).any() or not torch.isfinite(record["scale"]).all() or record["scale"].numel() != 1:
            raise ValueError("invalid ternary code or scale")
        parent, _, leaf = name.rpartition(".")
        setattr(model.get_submodule(parent), leaf, PackedLinear(record))
    state = dict(body["state"])
    for name, record in body["projections"].items():
        for key in ("packed", "scale", "bias"):
            if record.get(key) is not None:
                state[name + "." + key] = record[key]
    model.load_state_dict(state, strict=True)
    return model.eval()
