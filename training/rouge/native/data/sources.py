"""Data sources for Rouge native pretraining (licence, revision, domain, language).

Every source is public and redistributable, or generated. Gated or unclear-
licence sets are excluded; the M58 dataset registry (datasets/registry.json)
covers post-training data separately.

- web_en: FineWeb-Edu, sample-10BT (ODC-By 1.0). Upstream pipeline: URL filtering,
  language ID, MinHash deduplication, educational-quality classifier (arXiv 2406.17557).
- web_de: FineWeb-2, deu_Latn (ODC-By 1.0). Upstream MinHash deduplication.
- math_web: OpenWebMath (ODC-By 1.0). Upstream deduplicated.
- code_py: Python source of permissively licensed projects at pinned tags,
  fetched as GitHub archives (licence per project below).
- math_synth, algo_synth: generated here with verified answers (seeded).

Revisions: Hugging Face sources are pinned by commit when the manifest is
built (`revision` in the manifest); a rebuild must use the same revision
and reproduce every shard hash.
"""

from __future__ import annotations

HF = {
    "web_en": {"repo": "HuggingFaceFW/fineweb-edu", "config": "sample-10BT", "split": "train", "field": "text",
               "license": "ODC-By-1.0", "lang": "en", "domain": "web"},
    "web_de": {"repo": "HuggingFaceFW/fineweb-2", "config": "deu_Latn", "split": "train", "field": "text",
               "license": "ODC-By-1.0", "lang": "de", "domain": "web"},
    "math_web": {"repo": "open-web-math/open-web-math", "config": None, "split": "train", "field": "text",
                 "license": "ODC-By-1.0", "lang": "en", "domain": "math"},
}

# (project, tag, archive URL, licence). Only files matching *.py are used; tests are kept (they are code).
CODE = [
    ("cpython", "v3.12.7", "https://codeload.github.com/python/cpython/tar.gz/refs/tags/v3.12.7", "PSF-2.0"),
    ("numpy", "v2.1.3", "https://codeload.github.com/numpy/numpy/tar.gz/refs/tags/v2.1.3", "BSD-3-Clause"),
    ("django", "5.1.3", "https://codeload.github.com/django/django/tar.gz/refs/tags/5.1.3", "BSD-3-Clause"),
    ("flask", "3.0.3", "https://codeload.github.com/pallets/flask/tar.gz/refs/tags/3.0.3", "BSD-3-Clause"),
    ("requests", "v2.32.3", "https://codeload.github.com/psf/requests/tar.gz/refs/tags/v2.32.3", "Apache-2.0"),
    ("scikit-learn", "1.5.2", "https://codeload.github.com/scikit-learn/scikit-learn/tar.gz/refs/tags/1.5.2", "BSD-3-Clause"),
    ("sympy", "sympy-1.13.3", "https://codeload.github.com/sympy/sympy/tar.gz/refs/tags/sympy-1.13.3", "BSD-3-Clause"),
    ("pandas", "v2.2.3", "https://codeload.github.com/pandas-dev/pandas/tar.gz/refs/tags/v2.2.3", "BSD-3-Clause"),
]

# Additional permissively licensed projects for the production corpus (mixture "v2"); the tournament
# corpus (mixture "v1") keeps CODE only, so its manifest stays reproducible.
CODE_EXTRA = [
    ("pytorch", "v2.5.1", "https://codeload.github.com/pytorch/pytorch/tar.gz/refs/tags/v2.5.1", "BSD-3-Clause"),
    ("transformers", "v4.46.3", "https://codeload.github.com/huggingface/transformers/tar.gz/refs/tags/v4.46.3", "Apache-2.0"),
    ("scipy", "v1.14.1", "https://codeload.github.com/scipy/scipy/tar.gz/refs/tags/v1.14.1", "BSD-3-Clause"),
    ("home-assistant", "2024.11.3", "https://codeload.github.com/home-assistant/core/tar.gz/refs/tags/2024.11.3", "Apache-2.0"),
    ("jax", "jax-v0.4.35", "https://codeload.github.com/jax-ml/jax/tar.gz/refs/tags/jax-v0.4.35", "Apache-2.0"),
    ("keras", "v3.6.0", "https://codeload.github.com/keras-team/keras/tar.gz/refs/tags/v3.6.0", "Apache-2.0"),
    ("airflow", "2.10.3", "https://codeload.github.com/apache/airflow/tar.gz/refs/tags/2.10.3", "Apache-2.0"),
    ("pydantic", "v2.9.2", "https://codeload.github.com/pydantic/pydantic/tar.gz/refs/tags/v2.9.2", "MIT"),
    ("fastapi", "0.115.5", "https://codeload.github.com/fastapi/fastapi/tar.gz/refs/tags/0.115.5", "MIT"),
    ("pytest", "8.3.3", "https://codeload.github.com/pytest-dev/pytest/tar.gz/refs/tags/8.3.3", "MIT"),
]

SYNTHETIC = {
    "math_synth": {"license": "generated", "lang": "en", "domain": "math"},
    "algo_synth": {"license": "generated", "lang": "en", "domain": "algorithmic"},
}

# Tournament mixture v1 (share of training tokens).
MIXTURE_V1 = {"web_en": 0.55, "web_de": 0.15, "code_py": 0.12, "math_web": 0.08, "math_synth": 0.05, "algo_synth": 0.05}
# Production mixture v2: same shares; code_py draws on CODE + CODE_EXTRA.
MIXTURE_V2 = dict(MIXTURE_V1)
MIXTURES = {"v1": MIXTURE_V1, "v2": MIXTURE_V2}
CODE_SETS = {"v1": CODE, "v2": CODE + CODE_EXTRA}
