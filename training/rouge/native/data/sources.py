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

# More permissively licensed projects for the production corpus (mixture "v3"): pretrain-v1 (mixture v2)
# supplied 59M of 264M planned code tokens (36k files seen; 40% dropped by boilerplate 13-grams). An archive
# that cannot be fetched is recorded in the manifest's code_missing; it is never replaced silently.
CODE_MORE = [
    ("sqlalchemy", "rel_2_0_36", "https://codeload.github.com/sqlalchemy/sqlalchemy/tar.gz/refs/tags/rel_2_0_36", "MIT"),
    ("dask", "2024.11.2", "https://codeload.github.com/dask/dask/tar.gz/refs/tags/2024.11.2", "BSD-3-Clause"),
    ("xarray", "v2024.11.0", "https://codeload.github.com/pydata/xarray/tar.gz/refs/tags/v2024.11.0", "Apache-2.0"),
    ("networkx", "networkx-3.4.2", "https://codeload.github.com/networkx/networkx/tar.gz/refs/tags/networkx-3.4.2", "BSD-3-Clause"),
    ("astropy", "v7.0.0", "https://codeload.github.com/astropy/astropy/tar.gz/refs/tags/v7.0.0", "BSD-3-Clause"),
    ("pip", "24.3.1", "https://codeload.github.com/pypa/pip/tar.gz/refs/tags/24.3.1", "MIT"),
    ("setuptools", "v75.6.0", "https://codeload.github.com/pypa/setuptools/tar.gz/refs/tags/v75.6.0", "MIT"),
    ("mypy", "v1.13.0", "https://codeload.github.com/python/mypy/tar.gz/refs/tags/v1.13.0", "MIT"),
    ("ray", "ray-2.39.0", "https://codeload.github.com/ray-project/ray/tar.gz/refs/tags/ray-2.39.0", "Apache-2.0"),
    ("mlflow", "v2.18.0", "https://codeload.github.com/mlflow/mlflow/tar.gz/refs/tags/v2.18.0", "Apache-2.0"),
    ("celery", "v5.4.0", "https://codeload.github.com/celery/celery/tar.gz/refs/tags/v5.4.0", "BSD-3-Clause"),
    ("scrapy", "2.12.0", "https://codeload.github.com/scrapy/scrapy/tar.gz/refs/tags/2.12.0", "BSD-3-Clause"),
    ("tornado", "v6.4.2", "https://codeload.github.com/tornadoweb/tornado/tar.gz/refs/tags/v6.4.2", "Apache-2.0"),
    ("aiohttp", "v3.11.7", "https://codeload.github.com/aio-libs/aiohttp/tar.gz/refs/tags/v3.11.7", "Apache-2.0"),
    ("tensorflow", "v2.18.0", "https://codeload.github.com/tensorflow/tensorflow/tar.gz/refs/tags/v2.18.0", "Apache-2.0"),
    ("statsmodels", "v0.14.4", "https://codeload.github.com/statsmodels/statsmodels/tar.gz/refs/tags/v0.14.4", "BSD-3-Clause"),
    ("sphinx", "v8.1.3", "https://codeload.github.com/sphinx-doc/sphinx/tar.gz/refs/tags/v8.1.3", "BSD-2-Clause"),
    ("black", "24.10.0", "https://codeload.github.com/psf/black/tar.gz/refs/tags/24.10.0", "MIT"),
    ("twisted", "twisted-24.10.0", "https://codeload.github.com/twisted/twisted/tar.gz/refs/tags/twisted-24.10.0", "MIT"),
    ("salt", "v3007.1", "https://codeload.github.com/saltstack/salt/tar.gz/refs/tags/v3007.1", "Apache-2.0"),
    ("zulip", "9.3", "https://codeload.github.com/zulip/zulip/tar.gz/refs/tags/9.3", "Apache-2.0"),
    ("numba", "0.60.0", "https://codeload.github.com/numba/numba/tar.gz/refs/tags/0.60.0", "BSD-2-Clause"),
    ("httpx", "0.27.2", "https://codeload.github.com/encode/httpx/tar.gz/refs/tags/0.27.2", "BSD-3-Clause"),
]

SYNTHETIC = {
    "math_synth": {"license": "generated", "lang": "en", "domain": "math"},
    "algo_synth": {"license": "generated", "lang": "en", "domain": "algorithmic"},
}

# Tournament mixture v1 (share of training tokens).
MIXTURE_V1 = {"web_en": 0.55, "web_de": 0.15, "code_py": 0.12, "math_web": 0.08, "math_synth": 0.05, "algo_synth": 0.05}
# Production mixture v2: same shares; code_py draws on CODE + CODE_EXTRA.
MIXTURE_V2 = dict(MIXTURE_V1)
# Production mixture v3: same shares; code_py draws on CODE + CODE_EXTRA + CODE_MORE, and the synthetic
# generators get enough seeds for their share (200k math_synth seeds gave 69M of 110M tokens).
MIXTURE_V3 = dict(MIXTURE_V1)
# Production mixture v4: same shares and code set as v3. pretrain-v2 (v3) still gave code_py 41% and math_web
# 89.9% of plan: collection now gathers 25% more text than the budget estimate (write_shards cuts at the exact
# budget), and code_py may repeat its documents for up to 2 epochs (little quality cost up to about 4 epochs:
# Muennighoff et al. 2023, "Scaling Data-Constrained Language Models").
MIXTURE_V4 = dict(MIXTURE_V1)
MIXTURES = {"v1": MIXTURE_V1, "v2": MIXTURE_V2, "v3": MIXTURE_V3, "v4": MIXTURE_V4}
CODE_SETS = {"v1": CODE, "v2": CODE + CODE_EXTRA, "v3": CODE + CODE_EXTRA + CODE_MORE, "v4": CODE + CODE_EXTRA + CODE_MORE}
SYNTH_SEEDS = {"v1": 200_000, "v2": 200_000, "v3": 1_000_000, "v4": 1_000_000}   # the token budget stops generation first
COLLECT_MARGIN = {"v1": 1.08, "v2": 1.08, "v3": 1.08, "v4": 1.25}
MAX_EPOCHS = {"v4": {"code_py": 2}}
