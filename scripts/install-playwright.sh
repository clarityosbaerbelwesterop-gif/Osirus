#!/usr/bin/env bash
# Chromium and its system libraries for Playwright on a GitHub runner.
# The apt mirror or the browser CDN sometimes stalls for many minutes; a
# stalled try is ended after five minutes (with every child process) and
# repeated once, so a job fails fast instead of hanging until its timeout.
set -uo pipefail
for attempt in 1 2; do
  if timeout --kill-after=15 "${PLAYWRIGHT_INSTALL_TIMEOUT:-300}" npx playwright install --with-deps chromium; then
    exit 0
  fi
  echo "::warning::Playwright install attempt ${attempt} failed or stalled"
  # A killed apt leaves dpkg half-configured; the next try needs it clean.
  sudo dpkg --configure -a || true
done
exit 1
