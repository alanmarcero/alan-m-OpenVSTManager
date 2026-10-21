# OpenVST Manager

A public desktop manager for Alan Marcero's seven audio-plugin repositories. The user requested creation, development, publication, release setup in the plugin repositories, macOS apps and Windows executables built on GitHub, and Linux source builds. This instruction authorizes implementation and publishing.

## Product

List the seven known audio projects, release availability, installed formats and versions, update status, and descriptions. Search and filter the library. Install, change version, update, remove managed installations, and update all installed plugins. Choose VST3 or AU (when available). GitHub release notes and project links open externally. Settings let users select installation locations and enable prereleases. Public use requires no account. Linux users can build the manager and plugins from source; unavailable Linux release assets clearly lead to source instructions.

## Architecture

Electron with a sandboxed local renderer, React/TypeScript UI, and small Node ESM core modules. The preload exposes only named IPC operations. Main validates input and sender. Fetch only public releases for a curated catalog of alanmarcero repositories. Do not fetch arbitrary code or execute downloaded installers. ZIP downloads are bounded, checked against GitHub SHA256 when present, safely extracted, and validated for known bundle names. Stage installs, preserve prior files during replacement, track receipts, and remove only managed files. Existing untracked bundles are detected but require an explicit overwrite decision; no automatic removal.

Use per-user plugin locations by default and selectable custom folders. Windows users may need to add the chosen VST3 folder in their DAW. Permission failures provide actionable messages, never silently elevate. Cache metadata for offline browsing; surface stale state and rate limits. Fetch releases on demand with short caching; stable by default. Explicit version choices support older releases. Keep registry/config out of the source tree.

## Design

Slate #25333c, silver #e8ecee, mist #f4f6f7, ink #1c2931, subdued teal #417b82. System sans with generous spacing; no promotional hero. A compact sidebar, large Library title, useful search/filter toolbar, elegant rows and a focused detail panel. One generated metallic sound sculpture provides the signature visual, with a simple code-native mark and understated plugin glyphs. Keyboard focus, readable contrast, reduced motion, loading/error/empty states.

## Distribution

Electron Builder creates macOS arm64/x64 DMGs and Windows x64 NSIS EXE installers in GitHub Actions on version tags. Linux CI checks source compatibility; no Linux releases are published. Signing uses credentials only if configured; otherwise release notes clearly state unsigned/ad-hoc signing. No credential changes are authorized or needed.

Each plugin repo retains its tests and validation, adds tag-based GitHub release publication where absent, and publishes stable ZIP assets. Preserve third-party licenses and notices. Make no unrelated private repositories public. Reference Gearmulator as functional inspiration; implement independently.

## Verification

Core tests cover release selection, unavailable assets, path traversal, symlinks, checksum mismatch, rollback, untracked files and uninstall ownership. UI exercise checks search, navigation, settings, version selection and status. Launch actual Electron, install a real GitHub asset into a disposable folder, inspect version receipt, replace, and remove. Verify packaged app launch, GitHub workflows, released assets, and all repository visibility.

## User refinements during implementation

Fix overlapping controls at default and minimum desktop window sizes. Provide a visible main-page Light / Dark / Cyberpunk switch, persisted locally. Generate dedicated cyberpunk images; preserve readability and restrained composition. Verify all three themes at 1220×820 and 860×620, including settings and removal confirmation.
