# Bundled llama.cpp binaries

This folder is shipped into the packaged app via electron-builder
`extraResources` (lands at `<app resources>/local-ai/bin/`). At runtime,
`electron/modules/localAi/llamacppRuntime.ts` prefers a binary found here
over anything downloaded into `userData`, so packaged builds run fully
offline.

## What to drop here (release step)

Place the platform-appropriate `llama-server` executable(s) here before
running `npm run make`:

- `llama-server.exe` — Windows x64
- `llama-server` — macOS (arm64 / x64 as built)

These come from a pinned [llama.cpp release](https://github.com/ggerganov/llama.cpp/releases).
Download the release archive for each target platform, extract
`llama-server`, and copy it here. The filenames must match the
`runtimeBinaries[].filename` values in
`electron/modules/localAi/catalog.data.json`.

## Why bundled rather than downloaded

The catalog's `runtimeBinaries[].url` entries are placeholders
(`.../PINNED/...`) on purpose: llama.cpp publishes binaries inside zip
archives, not as bare executables, so the in-app downloader cannot fetch
them directly. Bundling the extracted binary is the supported path and is
covered by llama.cpp's MIT license (see `THIRD_PARTY_NOTICES.md`).

## Notes

- This README is the only tracked file in the folder so the path exists in
  a fresh checkout. The actual binaries are intentionally **not** committed
  (large, platform-specific) and should be added by the release build.
- If no bundled binary is present and no real download URL/SHA is pinned,
  managed local AI setup fails with a clear "runtime not ready" error
  rather than shipping something unverified.
