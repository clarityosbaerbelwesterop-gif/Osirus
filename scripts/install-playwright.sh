#!/usr/bin/env bash
# Chromium and its system libraries for Playwright on a GitHub runner.
#
# The browser comes from Playwright's CDN (fast). The system packages come
# from the Ubuntu mirror, which sometimes crawls for many minutes; the runner
# image already has every library Chromium needs, the packages add fonts and
# upgrades. So: the browser download is retried once, the packages get a hard
# time limit (as root, so the limit reaches apt itself), and a job goes on
# without them only when Chromium starts.
#
# PLAYWRIGHT_DEPS=skip leaves the system packages out (no screenshot
# comparisons, e.g. the production journey).
set -uo pipefail

browser_timeout="${PLAYWRIGHT_INSTALL_TIMEOUT:-300}"
deps_timeout="${PLAYWRIGHT_DEPS_TIMEOUT:-420}"

installed=0
for attempt in 1 2; do
  if timeout --kill-after=15 "$browser_timeout" npx playwright install chromium; then
    installed=1
    break
  fi
  echo "::warning::Chromium download attempt ${attempt} failed or stalled"
done
[ "$installed" = 1 ] || exit 1

if [ "${PLAYWRIGHT_DEPS:-install}" != "skip" ]; then
  if ! sudo -E env "PATH=$PATH" timeout --kill-after=15 "$deps_timeout" \
    npx playwright install-deps chromium; then
    echo "::warning::System packages for Chromium failed or stalled; going on with the runner image's"
    # A killed apt leaves its lock holder or a half-configured dpkg behind.
    sudo pkill -9 -x apt-get || true
    sudo pkill -9 -x dpkg || true
    sudo dpkg --configure -a || true
  fi
fi

# The only thing that matters: Chromium starts.
node -e "require('@playwright/test').chromium.launch().then((b) => b.close()).catch((e) => { console.error(e.message); process.exit(1); })"
