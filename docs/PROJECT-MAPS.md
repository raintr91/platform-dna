# Portable project maps

Schemas:

- `templates/schemas/platform-repos.schema.json`
- `templates/schemas/legacy-repos.schema.json`

Committed `platform-repos.json` describes the current repository only:

```json
{
  "defaultGroup": "fe",
  "harness": {
    "profiles": {
      "fe": { "groups": ["fe"], "skills": [] }
    }
  },
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
- **Platform DNA is the only writer.** Specialist kits (Hubdocs, Bundlekit,
  Processkit, Codegenkit, Testkit) never create or modify project maps; each
  kit tracks its installed skills in its own `install-manifest.json`.
- The map is repo identity for tooling, not a skill registry; installed-skill
  truth lives in each kit's manifest.
- Member checkout roots belong in ignored `platform-repos.local.json` or
  `legacy-repos.local.json`.
- Docs profiles seed empty legacy maps for greenfield repositories.
