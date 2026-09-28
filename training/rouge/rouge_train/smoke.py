"""CI smoke run: the real training path on a tiny model. NOT Rouge.

Builds a randomly initialised model of the base's own architecture class
(Qwen3_5ForConditionalGeneration, same layer pattern of Gated DeltaNet and
gated attention, same vision tower type) but a few hundred thousand
parameters, then runs every stage Rouge's real training uses:

    dataset -> chat template -> tokenisation -> forward -> backward ->
    optimizer -> LoRA -> checkpoint -> interrupt -> resume -> adapter ->
    merge -> reload -> inference -> evaluation -> base-vs-candidate report

and asserts what must hold: loss falls, an interrupted-and-resumed run
equals an uninterrupted one, the merged weights differ from the base,
tensors the loader drops are carried over, and the candidate beats the
base on the behaviour it was trained for.

With --tokenizer pointing at the pinned Qwen3.5-27B tokenizer (CI), the
real tokenizer and chat template are exercised; without it a tiny local
ChatML tokenizer is built.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import torch

from .config import LoraSettings, RunConfig
from .evaluate import compare, generate, score
from .manifest import load_base
from .merge import merge, weight_delta
from .train import train

CHATML = (
    "{% for message in messages %}<|im_start|>{{ message['role'] }}\n"
    "{{ message['content'] }}<|im_end|>\n{% endfor %}"
    "{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}"
)
SPECIALS = [
    "<|endoftext|>", "<|im_start|>", "<|im_end|>", "<|vision_start|>",
    "<|vision_end|>", "<|image_pad|>", "<|video_pad|>", "<think>", "</think>",
]


def tiny_tokenizer(out: Path):
    from tokenizers import Tokenizer, models, pre_tokenizers, trainers
    from transformers import PreTrainedTokenizerFast

    corpus = [
        "Who are you? I am Rouge. Wer bist du? Ich bin Rouge.",
        "user assistant system reverse the letters answer",
        "abcdefghijklmnopqrstuvwxyz 0123456789 .,:;!?-",
    ] * 50
    tok = Tokenizer(models.BPE(unk_token="<|endoftext|>"))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.train_from_iterator(corpus, trainers.BpeTrainer(vocab_size=400, special_tokens=SPECIALS))
    from tokenizers import decoders

    tok.decoder = decoders.ByteLevel()
    fast = PreTrainedTokenizerFast(
        tokenizer_object=tok, eos_token="<|im_end|>", pad_token="<|endoftext|>",
        additional_special_tokens=SPECIALS[3:],
    )
    fast.chat_template = CHATML
    fast.save_pretrained(out)
    return fast


def tiny_model(tokenizer, out: Path, seed: int) -> None:
    """A tiny Qwen3.5 of the base's architecture, derived from its config."""
    from transformers import AutoConfig, AutoModelForImageTextToText

    real = load_base()["config"]
    text = dict(real["text_config"])
    text.update(
        hidden_size=64, intermediate_size=128, num_hidden_layers=4,
        layer_types=["linear_attention"] * 3 + ["full_attention"],
        num_attention_heads=4, num_key_value_heads=2, head_dim=32,
        linear_num_key_heads=2, linear_num_value_heads=4,
        linear_key_head_dim=16, linear_value_head_dim=16,
        vocab_size=len(tokenizer), max_position_embeddings=4096,
        eos_token_id=tokenizer.eos_token_id, pad_token_id=tokenizer.pad_token_id,
    )
    text["rope_parameters"] = dict(text["rope_parameters"], mrope_section=[2, 1, 1])
    vision = dict(real["vision_config"])
    vision.update(depth=1, hidden_size=32, intermediate_size=64, num_heads=2, out_hidden_size=64, num_position_embeddings=64)
    ids = tokenizer.convert_tokens_to_ids
    config_dict = dict(
        real, text_config=text, vision_config=vision,
        image_token_id=ids("<|image_pad|>"), video_token_id=ids("<|video_pad|>"),
        vision_start_token_id=ids("<|vision_start|>"), vision_end_token_id=ids("<|vision_end|>"),
    )
    config_dict.pop("transformers_version", None)
    (out / "config.json").parent.mkdir(parents=True, exist_ok=True)
    (out / "config.json").write_text(json.dumps(config_dict))
    config = AutoConfig.from_pretrained(out)
    torch.manual_seed(seed)
    model = AutoModelForImageTextToText.from_config(config)
    model.save_pretrained(out, safe_serialization=True)
    # The real base carries tensors the loading class ignores (the MTP
    # head). Add one so the merge's carry-over path is exercised too.
    from safetensors.torch import load_file, save_file

    shard = out / "model.safetensors"
    tensors = load_file(str(shard))
    tensors["mtp.smoke_marker"] = torch.arange(8, dtype=torch.float32)
    save_file(tensors, str(shard), metadata={"format": "pt"})


def smoke_data(out: Path) -> tuple[Path, Path]:
    prompts = [
        "Who are you?", "What model are you?", "Introduce yourself.",
        "Wer bist du?", "Stell dich vor.", "What is your name?",
    ]
    train_rows = [
        {"id": f"t{i}", "source": "smoke", "messages": [
            {"role": "user", "content": prompts[i % len(prompts)]},
            {"role": "assistant", "content": "I am Rouge."},
        ]}
        for i in range(48)
    ]
    eval_rows = [
        {"id": f"e{i}", "category": "identity", "messages": [{"role": "user", "content": p}],
         "check": {"type": "contains_all", "terms": ["Rouge"]}}
        for i, p in enumerate(prompts[:4])
    ]
    train_path, eval_path = out / "train.jsonl", out / "eval.jsonl"
    train_path.write_text("\n".join(json.dumps(r) for r in train_rows) + "\n")
    eval_path.write_text("\n".join(json.dumps(r) for r in eval_rows) + "\n")
    return train_path, eval_path


def run(workdir: Path, tokenizer_path: str | None) -> dict:
    from transformers import AutoTokenizer

    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True)
    tok_dir = workdir / "tokenizer"
    if tokenizer_path:
        tokenizer = AutoTokenizer.from_pretrained(tokenizer_path)
        tokenizer.save_pretrained(tok_dir)
    else:
        tokenizer = tiny_tokenizer(tok_dir)
    base_dir = workdir / "tiny-base"
    tiny_model(tokenizer, base_dir, seed=7)
    tokenizer.save_pretrained(base_dir)
    train_path, eval_path = smoke_data(workdir)

    def config(name: str, stop_after=None) -> RunConfig:
        return RunConfig(
            name="rouge-1-sft-001", base_path=str(base_dir), tokenizer_path=str(tok_dir),
            train_file=str(train_path), eval_file=str(eval_path), output_dir=str(workdir / name),
            seed=11, lora=LoraSettings(rank=8, alpha=16, dropout=0.0),
            quantization="none", dtype="float32", gradient_checkpointing=True,
            max_seq_len=256, micro_batch_size=4, grad_accum=2, learning_rate=5e-3,
            warmup_ratio=0.1, epochs=6, loss_chunk_tokens=16, save_every=5, log_every=1,
            stop_after=stop_after,
        )

    straight = train(config("run-straight"))
    first = train(config("run-resumed", stop_after=7))
    assert first["status"] == "stopped", first
    resumed = train(config("run-resumed"))
    assert resumed["resumed_from"] == "step-000007", resumed["resumed_from"]

    from safetensors.torch import load_file

    a = load_file(str(workdir / "run-straight" / "adapter" / "adapter_model.safetensors"))
    b = load_file(str(workdir / "run-resumed" / "adapter" / "adapter_model.safetensors"))
    resume_diff = max((a[k] - b[k]).abs().max().item() for k in a)

    merged_dir = workdir / "rouge-1-sft-001-merged"
    merged = merge(config("run-straight"), workdir / "run-straight" / "adapter", merged_dir)
    delta = weight_delta(base_dir, merged_dir)

    items = [json.loads(line) for line in eval_path.read_text().splitlines()]
    settings = {"max_new_tokens": 12, "temperature": 0.0, "seed": 0}
    base_scores = score(items, generate(str(base_dir), items, settings))
    rouge_responses = generate(str(merged_dir), items, settings)
    rouge_scores = score(items, rouge_responses)
    comparison = compare(items, base_scores, rouge_scores)

    report = {
        "note": "CI smoke run on a tiny random model of the base architecture. This is not Rouge.",
        "tokenizer": "pinned Qwen3.5-27B" if tokenizer_path else "tiny local ChatML",
        "steps": straight["steps"],
        "first_loss": straight["first_loss"],
        "final_loss": straight["final_loss"],
        "resume_max_abs_diff": resume_diff,
        "trainable_parameters": straight["trainable_parameters"],
        "lora_targets": straight["lora_targets"],
        "data": straight["data"],
        "weight_delta": delta,
        "carried_from_base": merged["carried_from_base"],
        "comparison": comparison,
        "sample_response": rouge_responses[0],
    }
    (workdir / "smoke-report.json").write_text(json.dumps(report, indent=1))

    assert straight["final_loss"] < 0.85 * straight["first_loss"], "loss did not fall"
    assert resume_diff < 1e-5, f"resumed run diverged: {resume_diff}"
    assert delta["changed"] > 0 and delta["max_abs_diff"] > 0, "merged weights equal the base"
    assert "mtp.smoke_marker" in merged["carried_from_base"], "base-only tensors were dropped"
    assert straight["lora_targets"] == 4 * 3 + 3 * 3 + 1 * 4, straight["lora_targets"]
    assert comparison["overall"]["rouge"] > comparison["overall"]["base"], comparison
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workdir", default="/tmp/rouge-smoke")
    parser.add_argument("--tokenizer", default=None)
    args = parser.parse_args()
    report = run(Path(args.workdir), args.tokenizer)
    print(json.dumps({k: v for k, v in report.items() if k != "data"}, indent=1))


if __name__ == "__main__":
    main()
