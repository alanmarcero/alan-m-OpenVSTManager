# Verification

Verification for the initial 0.1.0 release, performed on 2026-10-21.

## Local checks

- Core suite covers archive traversal/symlinks/case collisions/size limits/CRC, download redirects and incomplete transfers, GitHub caching/rate limits/UTF-8, release platform/architecture selection, receipt ownership, managed replacement/removal, and crash recovery.
- Recovery tests terminate real subprocesses before and after receipt commit during both installation and removal, then restart and inspect files.
- Browser suite: 9 tests. Light, Dark, and Cyberpunk at 1220×820 and 860×620; control bounding-box collisions, theme persistence, settings, removal confirmation, failed installation/retry, and mixed-version updates.
- Actual Electron macOS flow: download openMaster v1.0.0 from public GitHub, install its legacy `Analog Master Strip.vst3`, update all to v1.0.1, confirm migration to `openMaster.vst3`, then remove and inspect receipts/files. Every plugin write went to a temporary folder.
- Generated macOS arm64 DMG locally. The packaged app launched, loaded seven plugins through its production protocol/preload, and passed `codesign --verify --deep --strict`.
- The release pipeline additionally launches the packaged application on each native runner and checks library loading and theme persistence in a temporary profile.

## Fixes found during verification

- Electron startup waited for readiness during module evaluation; readiness initialization now runs after module evaluation.
- Historical openMaster releases use a different bundle name; the catalog explicitly allows the verified legacy name.
- GitHub release-note decoding now preserves UTF-8 characters across network chunk boundaries.
- Log and download-cache cleanup failures no longer misreport committed installations as failed.
- Update-all compares semantic versions per installed format, preserving newer versions and promoting prereleases to their stable version.
- Windows file IDs can exceed JavaScript's safe integer range. Ownership now uses lossless bigint-backed decimal IDs, with compatibility for earlier safe numeric receipts.
- The chosen Electron runtime declares macOS 13 as its minimum; packaging and installation instructions match it.

## Scope and limitations

The manager installs files; it does not host or run audio plugins. Plugin DSP and host validation are performed in each plugin repository's CI and recorded in [the release audit](plugin-release-audit.md). The Windows and macOS manager installers are unsigned/ad-hoc signed, respectively, and macOS builds are not notarized.

Each archive's selected formats commit together. If a future plugin uses separate archives for different formats, each archive commits independently; the UI refreshes installed state after a later archive fails. Today's supported macOS releases package their supported formats together.

Production npm dependencies report no known vulnerabilities in the checked lockfile. The build-only electron-builder dependency tree includes an npm-reported moderate sprintf-js advisory with no patched sprintf-js version available at verification time; it is not part of the manager's runtime dependency set.
