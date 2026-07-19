# Portable project maps

Schemas:

- `templates/schemas/platform-repos.schema.json`

Committed `platform-repos.json` describes the current repository only:

```json
{
  "defaultGroup": "fe",
  "groups": {
    "fe": { "primary": "portal", "projects": ["portal"] }
  },
  "projects": {
    "portal": {
      "root": ".",
      "role": "fe",
      "repo": "portal",
      "write": true
    }
  }
}
```

Rules:

- `root` is `"."`; no sibling or machine checkout paths.
- Public repository URLs are optional.
- The map contains repositories only. It has no toolkit, skill, adapter, or
  install-state section.
- **Platform DNA is the only writer.** Specialist kits (Hubdocs, Bundlekit,
  Processkit, Codegenkit, Testkit) never create or modify project maps; each
  kit tracks its installed skills in its own `install-manifest.json`.
- Member checkout roots belong in ignored `platform-repos.local.json`.

## Lifecycle ownership

When `platform-dna init` creates `platform-repos.json` or
`platform-repos.example.json`, their SHA-256 values are stored in
`.platform-dna/install-manifest.json`. `platform-dna deinit` (one destination
repo) and global `platform-dna uninstall` remove those maps only while the
recorded hash still matches. A map that existed before init, or that a member
modified afterward, is preserved and reported.

`platform-dna prune` is deliberately narrower: it removes only stale,
unmodified harness assets. It never prunes project maps or another toolkit's
files.

Legacy evidence is a Bundlekit concern. Its schema and
`legacy-repos{,.example}.json` seeding live in Bundlekit, not Platform DNA.
