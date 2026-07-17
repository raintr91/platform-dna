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
- Package init merges only package-owned skill IDs.
- Member checkout roots belong in ignored `platform-repos.local.json` or
  `legacy-repos.local.json`.
- Docs profiles seed empty legacy maps for greenfield repositories.
