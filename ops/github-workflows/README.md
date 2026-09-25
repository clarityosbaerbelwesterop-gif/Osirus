# Workflow files waiting for a maintainer

The token that pushed the M49 recovery branch does not have GitHub's
`workflow` scope, and GitHub refuses any push that creates or changes a file
under `.github/workflows/` without it. These two files are therefore staged
here. A maintainer with that scope should move them into place in a
follow-up commit, without edits:

```sh
git mv ops/github-workflows/provider-diagnostics.yml .github/workflows/provider-diagnostics.yml
cp ops/github-workflows/sync-runtime-configuration.yml .github/workflows/sync-runtime-configuration.yml
git rm ops/github-workflows/sync-runtime-configuration.yml
```

- `provider-diagnostics.yml`: new. The manual three-key UnoRouter diagnostics
  (see `docs/provider-diagnostics.md`). Until it is in `.github/workflows/` on
  the default branch it cannot be dispatched.
- `sync-runtime-configuration.yml`: updated. Adds the `model_policy` input,
  drops the legacy `grok-4.6` default and the `vars.OSIRUS_PRIMARY_MODEL`
  fallback, and re-runs the sync when `scripts/lib/vercel-env.mjs` changes.

The M49 runtime sync script already works with the **current** workflow: it
ignores the legacy `grok-4.6` value under the default free-first policy and
rewrites every model role to the verified free pool. Moving the updated
workflow in only removes the legacy input and adds the explicit policy choice.
