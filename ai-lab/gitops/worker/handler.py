"""Ephemeral GitOps worker: QLoRA training + eval, CPU MergeKit merge, eval.

Entry points:
  RunPod serverless  `python handler.py` (runpod.serverless.start)
  Modal              modal_app.py calls run_job(payload, provider_job_id)

Secrets come from the worker environment only: HF_TOKEN (read base/datasets,
write outputs) and GITHUB_DISPATCH_TOKEN (fine-grained, this repository,
Contents: write) for the result callback. The payload never carries secrets.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

import jobs

MERGEKIT_BIN = os.environ.get("MERGEKIT_BIN", "/opt/mergekit/bin/mergekit-yaml")


def _bnb_config():
    import torch
    from transformers import BitsAndBytesConfig

    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )


def _load_4bit(repo: str, revision: str):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(repo, revision=revision)
    model = AutoModelForCausalLM.from_pretrained(
        repo, revision=revision, quantization_config=_bnb_config(), dtype=torch.bfloat16, device_map="auto"
    )
    return model, tokenizer


def _evaluate(model, tokenizer, suites: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every model in the program is evaluated 4-bit with the same harness
    settings, so parent and merge numbers are comparable."""
    from lm_eval import simple_evaluate
    from lm_eval.models.huggingface import HFLM

    if any(s["unsafeCode"] for s in suites):
        os.environ["HF_ALLOW_CODE_EVAL"] = "1"
    lm = HFLM(pretrained=model, tokenizer=tokenizer, batch_size="auto")
    metrics = []
    for suite in suites:
        out = simple_evaluate(
            model=lm,
            tasks=[suite["task"]],
            limit=suite["limit"],
            log_samples=False,
            confirm_run_unsafe_code=suite["unsafeCode"],
        )
        metrics += jobs.extract_metrics(out["results"], [suite])
    return metrics


def _publish(folder: Path, repo: str, card: str, message: str) -> dict[str, str]:
    from huggingface_hub import HfApi

    (folder / "README.md").write_text(card + "\n", encoding="utf-8")
    api = HfApi()
    api.create_repo(repo, private=True, exist_ok=True)
    commit = api.upload_folder(repo_id=repo, folder_path=str(folder), commit_message=message)
    return {"uri": f"hf://{repo}", "revision": commit.oid}


def train(p: dict[str, Any], work: Path) -> tuple[dict[str, str], list[dict[str, Any]]]:
    from datasets import concatenate_datasets, load_dataset
    from peft import LoraConfig
    from trl import SFTConfig, SFTTrainer

    t = p["train"]
    h = t["hyperparameters"]
    parts = [
        load_dataset(d["repo"], revision=d["revision"], split="train").map(jobs.to_prompt_completion)
        for d in t["datasets"]
    ]
    data = concatenate_datasets([d.select_columns(["prompt", "completion"]) for d in parts]).shuffle(seed=h["seed"])
    model, tokenizer = _load_4bit(t["base"]["repo"], t["base"]["revision"])
    lora = LoraConfig(
        r=h["rank"],
        lora_alpha=h["alpha"],
        lora_dropout=h["dropout"],
        target_modules=h["targetModules"],
        task_type="CAUSAL_LM",
    )
    args = SFTConfig(
        output_dir=str(work / "trainer"),
        num_train_epochs=h["epochs"],
        per_device_train_batch_size=h["microBatchSize"],
        gradient_accumulation_steps=h["gradientAccumulation"],
        learning_rate=h["learningRate"],
        lr_scheduler_type=h["lrScheduler"],
        warmup_ratio=h["warmupRatio"],
        gradient_checkpointing=h["gradientCheckpointing"],
        bf16=True,
        seed=h["seed"],
        max_length=h["maxSeqLength"],
        completion_only_loss=True,
        save_strategy="no",
        logging_steps=10,
        report_to=[],
    )
    trainer = SFTTrainer(model=model, args=args, train_dataset=data, peft_config=lora, processing_class=tokenizer)
    trainer.train()
    adapter_dir = work / "adapter"
    trainer.save_model(str(adapter_dir))
    trainer.model.eval()
    metrics = _evaluate(trainer.model, tokenizer, t["suites"])
    outputs = _publish(adapter_dir, t["publish"], t["modelCard"], f"{p['runId']} ({p['inputHash'][:12]})")
    return outputs, metrics


def _assert_lora_applied(out_dir: Path, base: dict[str, str]) -> None:
    """MergeKit applies `base+lora` silently by tensor name; if names do not
    line up, the output equals the base. Compare one adapted tensor."""
    import json

    import torch
    from huggingface_hub import hf_hub_download
    from safetensors import safe_open

    out_index = json.loads((out_dir / "model.safetensors.index.json").read_text())["weight_map"]
    name = next(k for k in sorted(out_index) if "language_model" in k and k.endswith("q_proj.weight"))
    base_index = json.loads(
        Path(hf_hub_download(base["repo"], "model.safetensors.index.json", revision=base["revision"])).read_text()
    )["weight_map"]
    base_shard = hf_hub_download(base["repo"], base_index[name], revision=base["revision"])
    with safe_open(str(out_dir / out_index[name]), "pt") as merged, safe_open(base_shard, "pt") as original:
        if torch.equal(merged.get_tensor(name), original.get_tensor(name).to(merged.get_tensor(name).dtype)):
            raise RuntimeError(f"merge left {name} identical to the base: adapters were not applied")


def merge(p: dict[str, Any], work: Path) -> tuple[dict[str, str], list[dict[str, Any]]]:
    m = p["merge"]
    config = work / "mergekit.yml"
    config.write_text(m["mergekitYaml"], encoding="utf-8")
    out_dir = work / "merged"
    # CPU merge: no --cuda. Lazy unpickling keeps peak RAM near one shard.
    subprocess.run([MERGEKIT_BIN, str(config), str(out_dir), "--lazy-unpickle", "--copy-tokenizer"], check=True)
    _assert_lora_applied(out_dir, m["base"])
    (out_dir / "mergekit_config.yml").write_text(m["mergekitYaml"], encoding="utf-8")
    return _publish(out_dir, m["publish"], m["modelCard"], f"{p['runId']} ({p['inputHash'][:12]})"), []


def evaluate(p: dict[str, Any], work: Path) -> tuple[dict[str, str], list[dict[str, Any]]]:
    e = p["eval"]
    model, tokenizer = _load_4bit(e["model"]["repo"], e["model"]["revision"])
    model.eval()
    metrics = _evaluate(model, tokenizer, e["suites"])
    return {"uri": f"hf://{e['model']['repo']}", "revision": e["model"]["revision"]}, metrics


STAGE_FNS = {"train": train, "merge": merge, "eval": evaluate}


def run_job(payload: dict[str, Any], provider_job_id: str) -> dict[str, Any]:
    started_at, t0 = jobs.utc_now(), time.monotonic()
    outputs, metrics, error = None, [], None
    try:
        jobs.validate_payload(payload)
        with tempfile.TemporaryDirectory(prefix="gitops-") as tmp:
            outputs, metrics = STAGE_FNS[payload["stage"]](payload, Path(tmp))
    except Exception:  # noqa: BLE001 - every failure must reach the record
        error = traceback.format_exc()
    record = jobs.build_record(
        payload,
        provider_job_id=provider_job_id,
        started_at=started_at,
        finished_at=jobs.utc_now(),
        elapsed_hours=(time.monotonic() - t0) / 3600,
        outputs=outputs,
        metrics=metrics,
        error=error,
    )
    try:
        jobs.callback(payload, record)
    except Exception:  # noqa: BLE001 - the provider still returns the record
        record = {**record, "callbackError": jobs.scrub(traceback.format_exc())[-500:]}
    return record


def runpod_handler(job: dict[str, Any]) -> dict[str, Any]:
    return run_job(job["input"], job.get("id", "unknown"))


if __name__ == "__main__":
    import runpod

    runpod.serverless.start({"handler": runpod_handler})
