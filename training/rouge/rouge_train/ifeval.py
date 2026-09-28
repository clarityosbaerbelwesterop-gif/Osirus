"""IFEval-style verifiable instruction checks (strict), for evaluation only.

Implements the instruction types of google/IFEval (Apache-2.0) whose
checks need no external model or language detector. An item is used only
if every one of its instructions is supported; the rest are skipped and
counted, never guessed.
"""

from __future__ import annotations

import json
import re


def _relation(value: int, relation: str | None, target: int) -> bool:
    if relation == "less than":
        return value < target
    return value >= target  # "at least" (IFEval's only other relation)


def _words(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


def _sentences(text: str) -> int:
    return len([s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s])


def check_one(instruction: str, kwargs: dict, response: str) -> bool:
    r = response
    k = {key: value for key, value in (kwargs or {}).items() if value is not None}
    if instruction == "punctuation:no_comma":
        return "," not in r
    if instruction == "length_constraints:number_words":
        return _relation(_words(r), k.get("relation"), int(k["num_words"]))
    if instruction == "length_constraints:number_sentences":
        return _relation(_sentences(r), k.get("relation"), int(k["num_sentences"]))
    if instruction == "length_constraints:number_paragraphs":
        parts = [p for p in re.split(r"\s?\*\*\*\s?", r) if p.strip()]
        return len(parts) == int(k["num_paragraphs"])
    if instruction == "detectable_format:number_bullet_lists":
        bullets = re.findall(r"^\s*[*-][^*-].*$", r, re.M)
        return len(bullets) == int(k["num_bullets"])
    if instruction == "detectable_format:json_format":
        body = r.strip().removeprefix("```json").removeprefix("```Json").removeprefix("```JSON").removeprefix("```").removesuffix("```").strip()
        try:
            json.loads(body)
            return True
        except ValueError:
            return False
    if instruction == "detectable_format:title":
        return any(title.strip() for title in re.findall(r"<<([^\n]+)>>", r))
    if instruction == "detectable_format:number_highlighted_sections":
        highlights = [h for h in re.findall(r"\*[^\n\*]*\*", r) + re.findall(r"\*\*[^\n\*]*\*\*", r) if h.strip("*").strip()]
        return len(highlights) >= int(k["num_highlights"])
    if instruction == "detectable_format:multiple_sections":
        splitter = k.get("section_spliter", "Section")
        sections = re.split(rf"\s?{re.escape(splitter)}\s?\d+\s?", r)
        return len(sections) - 1 >= int(k["num_sections"])
    if instruction == "change_case:english_lowercase":
        return r == r.lower() and r != r.upper()
    if instruction == "change_case:english_capital":
        return r == r.upper()
    if instruction == "keywords:existence":
        return all(re.search(re.escape(word), r, re.I) for word in k["keywords"])
    if instruction == "keywords:forbidden_words":
        return not any(re.search(rf"\b{re.escape(word)}\b", r, re.I) for word in k["forbidden_words"])
    if instruction == "keywords:frequency":
        count = len(re.findall(re.escape(k["keyword"]), r, re.I))
        return _relation(count, k.get("relation"), int(k["frequency"]))
    if instruction == "keywords:letter_frequency":
        count = r.lower().count(k["letter"].lower())
        return _relation(count, k.get("let_relation"), int(k["let_frequency"]))
    if instruction == "startend:end_checker":
        return r.strip().lower().endswith(k["end_phrase"].strip().lower())
    if instruction == "startend:quotation":
        s = r.strip()
        return len(s) > 1 and s[0] == '"' and s[-1] == '"'
    if instruction == "detectable_content:postscript":
        marker = k["postscript_marker"].strip()
        return re.search(rf"\s*{re.escape(marker.lower())}.*$", r.lower(), re.M) is not None
    if instruction == "detectable_content:number_placeholders":
        return len(re.findall(r"\[.*?\]", r)) >= int(k["num_placeholders"])
    if instruction == "combination:repeat_prompt":
        return r.strip().lower().startswith(k["prompt_to_repeat"].strip().lower())
    if instruction == "combination:two_responses":
        parts = [p for p in r.split("******") if p.strip()]
        return len(parts) == 2 and parts[0].strip() != parts[1].strip()
    raise KeyError(instruction)


SUPPORTED = {
    "punctuation:no_comma", "length_constraints:number_words", "length_constraints:number_sentences",
    "length_constraints:number_paragraphs", "detectable_format:number_bullet_lists",
    "detectable_format:json_format", "detectable_format:title", "detectable_format:number_highlighted_sections",
    "detectable_format:multiple_sections", "change_case:english_lowercase", "change_case:english_capital",
    "keywords:existence", "keywords:forbidden_words", "keywords:frequency", "keywords:letter_frequency",
    "startend:end_checker", "startend:quotation", "detectable_content:postscript",
    "detectable_content:number_placeholders", "combination:repeat_prompt", "combination:two_responses",
}


def check(spec: dict, response: str) -> bool:
    return all(check_one(i["id"], i.get("kwargs") or {}, response) for i in spec["instructions"])
