"""Fetch a production corpus from the Lightning model registry into one flat directory and verify it.

    python lightning_ai/corpus.py fetch CORPUS DATA_DIR

The committed manifest (configs/native/<corpus>/manifest.json) decides the layout: a corpus built on one
runner is one registry model (rouge/data/<corpus>); a corpus built one source per runner lists its parts
(`parts`: source -> registry path). Parts unpack into DATA_DIR/train and DATA_DIR/val, the committed
manifest becomes DATA_DIR/manifest.json, and every shard hash is checked before training.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

import storage  # noqa: E402


def fetch(corpus: str, data: str, download=storage.download) -> Path:
    manifest = json.loads((ROOT / f"configs/native/{corpus}/manifest.json").read_text())
    out = Path(data)
    out.mkdir(parents=True, exist_ok=True)
    remotes = list(manifest.get("parts", {}).values()) or [f"rouge/data/{corpus}"]
    for remote in remotes:
        tmp = Path(tempfile.mkdtemp(dir=out))
        root = Path(download(remote, str(tmp))["root"])
        for split in ("train", "val"):
            (out / split).mkdir(exist_ok=True)
            for f in sorted((root / split).glob("*.bin")) if (root / split).exists() else []:
                shutil.move(str(f), out / split / f.name)
        if not (out / "tokenizer.json").exists():
            shutil.copy(root / "tokenizer.json", out / "tokenizer.json")
        shutil.rmtree(tmp)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    from native.data.verify import verify

    problems = verify(out, manifest)
    if problems:
        raise SystemExit(f"{corpus}: {len(problems)} problem(s), first: {problems[:3]}")
    print(f"[corpus] {corpus}: {len(remotes)} part(s) fetched and verified into {out}", flush=True)
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "fetch":
        raise SystemExit(__doc__)
    fetch(sys.argv[2], sys.argv[3])
