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

Legacy evidence is a Bundlekit concern. Its schema and
`legacy-repos{,.example}.json` seeding live in Bundlekit, not Platform DNA.
