# Ephemeral GitOps worker image for RunPod serverless and Modal.
# PyPI torch wheels for Linux x86_64 bundle the CUDA runtime; the host only
# needs an NVIDIA driver. The same image runs the CPU-only merge.
FROM python:3.11-slim

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements-train.txt requirements-merge.txt /tmp/
RUN pip install -r /tmp/requirements-train.txt \
 && python -m venv --system-site-packages /opt/mergekit \
 && /opt/mergekit/bin/pip install -r /tmp/requirements-merge.txt

WORKDIR /worker
COPY jobs.py handler.py ./

CMD ["python", "-u", "handler.py"]
