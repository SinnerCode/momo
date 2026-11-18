# Momo build tooling

Everything Momo adds lives in `i18n/` and `.github/`. No upstream Peach file is edited, so upstream merges do not conflict.

Peach has its own English interface since 0.58.0, so Momo no longer translates. The build renames Peach to Momo and swaps the icon.

| File | Role |
| --- | --- |
| `ts.mjs` | Renames Peach to Momo in `frontend/src` (oxc-parser AST), `web/index.html` and `resources/locales`; sets the page language to English |
| `py.py` | Swaps the favicon in `src/peach/web_state.py` |
| `en.json` | Strings to replace outright (the page title) |
| `allow.txt`, `backend-strings.json` | Inputs `ts.mjs` and `py.py` still read; empty |
| `brand/` | Momo logo and icon, installed under Peach's file names |
| `Dockerfile` | Official Peach image + renamed locales + rebuilt frontend + Momo icon; `PEACH_LANGUAGE=en` |

## Rename rules

- The standalone word "Peach" becomes "Momo" in displayed text: locale values and frontend string literals. `peach-*`, `Peach.app`, `X-Peach-*`, the `peach` CLI and env vars stay.
- A frontend string in a matching position (comparisons, keys, literal types) is data and is not renamed.
- Chinese strings left in Peach's code are data (site field names, title patterns, tag lists). Never translate them; scraping depends on them.

## Update to a new Peach release

```sh
git fetch upstream --tags
git merge v0.60.0                       # the release tag
```

1. Set `BASE` in `i18n/Dockerfile` to the official image of that release: `longmeidao/peach:<version>@<digest>`.
2. Check the renamed tree: copy the repo, run `py.py apply` and `ts.mjs apply` on the copy, then `npm run typecheck && npm run lint && npm run build` in its `frontend/`.
3. Build: `docker buildx build -f i18n/Dockerfile -t ghcr.io/sinnercode/momo:<version> .`
