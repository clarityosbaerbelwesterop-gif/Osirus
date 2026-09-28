"""SFT data: JSONL conversations → token ids with assistant-only labels.

A record:
    {"id": "...", "source": "<registry id>", "messages": [
        {"role": "system"|"user"|"assistant", "content": "..."}, ...]}

The chat template is the base model's own (tokenizer.apply_chat_template).
Only assistant turns are learned: every other token is masked with -100.
The rendered conversation is searched for each assistant turn's header
(`<|im_start|>assistant\n` for Qwen's ChatML) and the end-of-turn marker
(`<|im_end|>`); every token overlapping the span between them -- the
reasoning block the template writes, the answer, and the end marker the
model must learn to emit -- is a label. Character offsets are mapped to
tokens, so BPE merges at the boundaries cannot shift the span. A record
with no assistant span, or longer than the sequence limit, is dropped and
counted -- never truncated mid-answer.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path

IGNORE = -100


@dataclass
class Example:
    id: str
    input_ids: list[int]
    labels: list[int]


@dataclass
class DataStats:
    records: int = 0
    kept: int = 0
    too_long: int = 0
    template_mismatch: int = 0
    no_assistant: int = 0
    tokens: int = 0
    trained_tokens: int = 0
    by_source: dict = field(default_factory=dict)


def read_jsonl(path: str | Path) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


RESPONSE_MARKER = "<|im_start|>assistant\n"
TURN_END = "<|im_end|>"


def assistant_spans(text: str, marker: str = RESPONSE_MARKER, end: str = TURN_END) -> list[tuple[int, int]]:
    """Character spans of assistant turns: after the header, through the end marker."""
    spans, cursor = [], 0
    while (found := text.find(marker, cursor)) != -1:
        begin = found + len(marker)
        stop = text.find(end, begin)
        stop = len(text) if stop == -1 else stop + len(end)
        spans.append((begin, stop))
        cursor = stop
    return spans


def encode(record: dict, tokenizer, max_len: int, stats: DataStats) -> Example | None:
    stats.records += 1
    text = tokenizer.apply_chat_template(record["messages"], tokenize=False)
    spans = assistant_spans(text)
    if not spans:
        stats.no_assistant += 1
        return None
    encoded = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)
    ids, offsets = encoded["input_ids"], encoded["offset_mapping"]
    labels = [IGNORE] * len(ids)
    for index, (start, stop) in enumerate(offsets):
        if any(start < span_end and stop > span_start for span_start, span_end in spans):
            labels[index] = ids[index]
    if all(label == IGNORE for label in labels):
        stats.template_mismatch += 1
        return None
    if len(ids) > max_len:
        stats.too_long += 1
        return None
    stats.kept += 1
    stats.tokens += len(ids)
    stats.trained_tokens += sum(1 for label in labels if label != IGNORE)
    source = record.get("source", "unknown")
    stats.by_source[source] = stats.by_source.get(source, 0) + 1
    return Example(record.get("id", str(stats.records)), ids, labels)


def load_examples(path: str | Path, tokenizer, max_len: int) -> tuple[list[Example], DataStats]:
    stats = DataStats()
    examples = [
        example
        for record in read_jsonl(path)
        if (example := encode(record, tokenizer, max_len, stats)) is not None
    ]
    return examples, stats


def epoch_order(count: int, seed: int, epoch: int) -> list[int]:
    """A reproducible shuffle per epoch (resume replays the same order)."""
    order = list(range(count))
    random.Random(f"{seed}:{epoch}").shuffle(order)
    return order


def collate(batch: list[Example], pad_id: int):
    import torch

    width = max(len(example.input_ids) for example in batch)
    ids = torch.full((len(batch), width), pad_id, dtype=torch.long)
    labels = torch.full((len(batch), width), IGNORE, dtype=torch.long)
    mask = torch.zeros((len(batch), width), dtype=torch.long)
    for row, example in enumerate(batch):
        n = len(example.input_ids)
        ids[row, :n] = torch.tensor(example.input_ids)
        labels[row, :n] = torch.tensor(example.labels)
        mask[row, :n] = 1
    return ids, labels, mask
