# Netlify usage audit and cleanup — 2026-10-07

The user confirmed there is **no hosted frontend deployment** and this project is
not deployed on Netlify. A read-only repository audit preceded all changes. No
current runtime, build script, test or deployment workflow requires Netlify.
No hosting provider was added and no Supabase staging/production calls were made.

## Every reference found before cleanup

Line numbers refer to the pre-cleanup working tree, which already had unrelated
uncommitted edits. Complete raw matches are retained in ignored local evidence
`tests/artifacts/netlify-cleanup/references-before.txt`. Generated/install outputs
(`node_modules`, `.next`, service workers) and historical ignored test artifacts
are not application-owned reference inventory; their package contents/checkpoint
reports do not establish active deployment usage.

| File / original lines | Reference | Classification / action |
| --- | --- | --- |
| netlify.toml, entire file; matches 7, 8, 11, 14 | Build command/publish path; NODE_VERSION; NEXT_DISABLE_EDGE_IMAGES; @netlify/plugin-nextjs; @netlify/plugin-lighthouse and report settings | Legacy hosting-only config; file deleted |
| package.json:61 | @netlify/plugin-nextjs dev dependency | Installed but unused by current scripts/source; removed |
| package-lock.json:53 | Root adapter dependency | Legacy; removed |
| package-lock.json:2619,2621 | @netlify/functions package and registry URL | Adapter-only dependency; removed |
| package-lock.json:2631,2633,2637 | @netlify/ipx package/URL and its functions dependency | Adapter-only dependency; removed |
| package-lock.json:2649 | @netlify/ipx/node_modules/mkdirp | Adapter-only nested dependency; removed |
| package-lock.json:2661,2663,2667,2668 | Adapter package/URL, functions and ipx dependencies | Legacy adapter subtree; removed |
| package-lock.json:2691,2706,2722,2734,2740,2749,2764 | Adapter-nested ansi-styles, chalk, color-convert, color-name, has-flag, semver, supports-color | Adapter-only nested packages; removed |
| package-lock.json:15910,15912 | v2 legacy @netlify/functions dependency section/URL | Legacy; removed |
| package-lock.json:15919,15921,15925 | v2 legacy @netlify/ipx section/URL/functions dependency | Legacy; removed |
| package-lock.json:15945,15947,15951,15952 | v2 legacy adapter section/URL/functions/ipx dependencies | Legacy; removed |
| README.md:6 | Node runtime described as matching Netlify build setting | Incorrect current deployment assumption; removed |
| README.md:16,39 | Upstream Netlify preview and latest-version/deployed statement | Original template preview, not this marketplace; removed |
| README.md:43,50 | Mobile/desktop screenshot links targeting upstream Netlify preview | Legacy; preview links removed, historical screenshot images retained/labeled |
| docs/PROJECT_STATUS.md:33,37 | Current Node metadata includes Netlify configuration/documentation | Stale current architecture statement/link; removed |
| docs/PROJECT_STATUS.md:119 | Historical check does not verify Netlify deployment | Changed to provider-neutral hosted-deployment wording |
| docs/supabase-setup.md:164 | Runtime matches Netlify build setting | Stale setup assumption; removed |
| docs/MESSAGES_BACKEND_DESIGN.md:589 | Future SSE fallback assumes Netlify Functions | Unselected future hosting assumption; made provider-neutral |
| docs/MESSAGES_PHASE1E_A2.md:113,114 | No connector/site state/CLI; inherited TOML observed during prior pre-flight | Historical audit evidence, not active integration; retained with explicit subsequent user clarification and cleanup link |

There were **44 matching lines** across eight files (27 in the lockfile).
Remaining Netlify words are audit/history or explicit statements that it is unused.
No runtime/dependency/config reference remains.

## Negative checks and dependency boundary

- No `.github` directory/workflows, `.netlify` site connection or Netlify deploy
  script. All package scripts use ordinary Next.js, the local staging launcher,
  ESLint or the separate Algolia CLI. None invokes a Netlify plugin or CLI.
- `next.config.js` contains no Netlify import/config. Source, scripts and tests
  contain no Netlify or NEXT_DISABLE_EDGE_IMAGES consumer. No NETLIFY_* variable
  names are present in process environment or local env files; values were not
  printed. No Netlify plugin import, require or dynamic import was found.
- The adapter is the only root Netlify dependency. @netlify/functions and
  @netlify/ipx are reachable only through that subtree. Lighthouse was configured
  only in the TOML, not a current package script/dependency.
- `sharp` is a **used shared dependency**, although it arrived via the adapter's
  image stack. Removing the whole adapter subtree exposed Next.js 12's local WASM
  image fallback incompatibility with Node 24/global fetch during banner import.
  It is now an explicit runtime dependency at its **existing version 0.30.7**.
  Native decoding was verified against the existing local JPEG. No Next/PWA/image
  behavior was disabled or redesigned to bypass this failure.
- Final lockfile prunes **80 unused package entries**, retains sharp's required
  subtree, keeps lockfileVersion=2 and changes no retained dependency versions.
  All @netlify nodes are gone. Existing root dependencies/scripts remain intact.
  Transient npm re-resolution of sharp dependencies was restored to original
  locked versions before final validation; no package upgrades are part of this pass.

## Files changed

- Deleted `netlify.toml`.
- Edited `package.json` and `package-lock.json`: remove adapter, explicitly retain
  required sharp, prune unused transitive entries.
- Edited `README.md`, `docs/PROJECT_STATUS.md`, `docs/supabase-setup.md`,
  `docs/MESSAGES_BACKEND_DESIGN.md`, `docs/MESSAGES_PHASE1E_A2.md` as described above.
- Added this report. During link validation, removed five existing README links
  to already-deleted retail widgets while retaining their historical names;
  corrected its missing Installation anchor and the design document's stale
  Project Status date anchor.
- Ignored local audit/network-block/build evidence only. `next.config.js`, PWA
  settings, Supabase config/migrations, `.env.local` and `.env.staging.local` were
  not edited. Existing unrelated working-tree changes were preserved.

## Validation and boundaries

TypeScript and local Messages/API/static migration/conversation tests passed after
adapter removal. Relevant ESLint passed; the untouched next.config.js has existing
CRLF endings, so its lint check used an endOfLine=auto allowance (no file edits).
Raw default lint on that file reported only those existing line-ending errors.

Production-mode build runs with outbound networking disabled using an ignored
local preload; it cannot contact either Supabase project or a hosting service.
Font-download optimization may be skipped in this offline check. Existing npm
engine warnings and Browserslist staleness warnings were observed. npm initially
left a locked native DLL directory during cleanup; it is ignored installed-package
state, not a source/deployment dependency. Required sharp was restored and local
native JPEG decoding passed before the final build.

Final production-mode build passed with networking disabled and required sharp
retained. Font optimization was skipped; compilation and all eight static pages
completed. All **98 local documentation paths/heading anchors** checked across
README and docs passed, as did `git diff --check`. Final TypeScript, relevant
ESLint, local API/static migration/conversation tests and dependency consistency
checks passed after dependency synchronization. `next.config.js` SHA256 remained
`3994cba5391c364202a8d88bdce4e9e37b8fc7ee8adbd791f9c52dde5e866c30`.
No new runtime tests were added for this config/documentation cleanup.
No Supabase command, migration application, deployment, commit or push occurred.
