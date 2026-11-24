#!/bin/sh
# Fails if anything that looks like a Google OAuth client, secret or token is
# tracked in git. This repository is public; OAuth clients are entered at
# runtime on each device and must never be committed.
# Run locally: tools/check-no-secrets.sh   (CI runs it on every push)
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
# Placeholders used in the UI are allowed: they start with 1234- or YOUR-.
hits=$(git grep -I -nE \
    -e '[0-9]+-[a-z0-9]{20,}\.apps\.googleusercontent\.com' \
    -e 'GOCSPX-[A-Za-z0-9_-]{10,}' \
    -e 'ya29\.[A-Za-z0-9_-]{20,}' \
    -e '1//0[A-Za-z0-9_-]{30,}' \
    -e 'AIza[0-9A-Za-z_-]{35}' \
    -- . ':!tools/check-no-secrets.sh' 2>/dev/null)
if [ -n "$hits" ]; then
    echo "Possible Google OAuth client, secret or token committed:" >&2
    echo "$hits" >&2
    exit 1
fi
echo "No OAuth clients, secrets or tokens found."
