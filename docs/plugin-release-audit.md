# Plugin release audit

Initial audit: 2026-10-21 13:48 UTC. The original seven public releases and 15 ZIP assets were downloaded without authentication and verified. openDucker was added later that day; its verification is recorded below, bringing the catalog to eight plugins and 17 ZIP assets.

| Repository / release | Exact source | Validation run | Project license |
| --- | --- | --- | --- |
| [openGlitchFX v1.0.0](https://github.com/alanmarcero/openGlitchFX/releases/tag/v1.0.0) | [8934bd2](https://github.com/alanmarcero/openGlitchFX/tree/8934bd2cd69eae12f5db1c61045d5ec60867d6cd) | [Passed](https://github.com/alanmarcero/openGlitchFX/actions/runs/39607551644) | MIT |
| [openEDMFilter v0.1.0](https://github.com/alanmarcero/openEDMFilter/releases/tag/v0.1.0) | [dacfbaf](https://github.com/alanmarcero/openEDMFilter/tree/dacfbafe2fea72887179601cf653e56b42520936) | [Passed](https://github.com/alanmarcero/openEDMFilter/actions/runs/39607561635) | MIT |
| [openSausage v1.0.0](https://github.com/alanmarcero/openSausage/releases/tag/v1.0.0) | [84f5834](https://github.com/alanmarcero/openSausage/tree/84f5834a00ee58a4d92aab7b874173f9dd4c009c) | [Passed](https://github.com/alanmarcero/openSausage/actions/runs/39607570914) | AGPL-3.0 |
| [openTunerEQ v1.0.0](https://github.com/alanmarcero/openTunerEQ/releases/tag/v1.0.0) | [326266e](https://github.com/alanmarcero/openTunerEQ/tree/326266e1e486b353f1e488cf75fcca579d8f05cb) | [Passed](https://github.com/alanmarcero/openTunerEQ/actions/runs/39607588737) | AGPL-3.0 |
| [openMaster v1.0.1](https://github.com/alanmarcero/openMaster/releases/tag/v1.0.1) | [35ce5ed](https://github.com/alanmarcero/openMaster/tree/35ce5ed9bd3fe223b2e82e9a8dac82b5ba158bf7) | [Passed](https://github.com/alanmarcero/openMaster/actions/runs/39607641103) | MIT |
| [winamp-classic-equalizer-vst v1.0.0](https://github.com/alanmarcero/winamp-classic-equalizer-vst/releases/tag/v1.0.0) | [0c3d34b](https://github.com/alanmarcero/winamp-classic-equalizer-vst/tree/0c3d34bebffb415b1f7547af525ea83a8f5af667) | [Passed](https://github.com/alanmarcero/winamp-classic-equalizer-vst/actions/runs/39607605155) | No project LICENSE file |
| [winamp-classic-visualizer-vst v1.0.0](https://github.com/alanmarcero/winamp-classic-visualizer-vst/releases/tag/v1.0.0) | [50da2f9](https://github.com/alanmarcero/winamp-classic-visualizer-vst/tree/50da2f948ceac7268c2baa1ca7f0ad56a76d7015) | [Passed](https://github.com/alanmarcero/winamp-classic-visualizer-vst/actions/runs/39607614204) | No project LICENSE file |

## Downloaded assets

| Repository | Asset | Architecture | SHA-256 |
| --- | --- | --- | --- |
| openGlitchFX | [openGlitchFX-VST3-macOS.zip](https://github.com/alanmarcero/openGlitchFX/releases/download/v1.0.0/openGlitchFX-VST3-macOS.zip) | arm64 + x86_64 | `79ce3c5c1bac0dea5369fe2c4df8230bb3eed2cd6088d0e9770d4b0a73d4569e` |
| openGlitchFX | [openGlitchFX-VST3-Windows.zip](https://github.com/alanmarcero/openGlitchFX/releases/download/v1.0.0/openGlitchFX-VST3-Windows.zip) | x86_64 | `e507a5d4697f337ca8a8d9fbd870f4664440d6259cc8f4674538b61a515eb587` |
| openEDMFilter | [openEDMFilter-Linux.zip](https://github.com/alanmarcero/openEDMFilter/releases/download/v0.1.0/openEDMFilter-Linux.zip) | x86_64 | `c97daa6ea94fd2b706b9ffa92e65558a0e409b14268b842a4037174295a97614` |
| openEDMFilter | [openEDMFilter-macOS.zip](https://github.com/alanmarcero/openEDMFilter/releases/download/v0.1.0/openEDMFilter-macOS.zip) | arm64 + x86_64 | `8bb8866ff4891869731e8f2485f5eb0faf7192a5929b74b68ca9d86cb6969651` |
| openEDMFilter | [openEDMFilter-Windows.zip](https://github.com/alanmarcero/openEDMFilter/releases/download/v0.1.0/openEDMFilter-Windows.zip) | x86_64 | `babc0012539faebc45475e8730dc50f54defa5c66fe19c5d83247a26b767ef54` |
| openSausage | [openSausage-macOS-universal.zip](https://github.com/alanmarcero/openSausage/releases/download/v1.0.0/openSausage-macOS-universal.zip) | arm64 + x86_64 | `4ff3895795619834c09af39db18e54864d00a64e1811f9d47876e31497388064` |
| openSausage | [openSausage-Windows-x64.zip](https://github.com/alanmarcero/openSausage/releases/download/v1.0.0/openSausage-Windows-x64.zip) | x86_64 | `b4053bf7baa00963aec3597e7a53e2c6083b25b04a4e6f27b69ebc90252f4164` |
| openTunerEQ | [openTunerEQ-macOS-universal.zip](https://github.com/alanmarcero/openTunerEQ/releases/download/v1.0.0/openTunerEQ-macOS-universal.zip) | arm64 + x86_64 | `7dbbb59867f803715bfaea5caf2a275811bee2e27d3ace8317aa4781cd59cc63` |
| openTunerEQ | [openTunerEQ-Windows-x64.zip](https://github.com/alanmarcero/openTunerEQ/releases/download/v1.0.0/openTunerEQ-Windows-x64.zip) | x86_64 | `01b914fc082e34debea284206af6c932e7ed6774ef7d21c89c70c77e9313731b` |
| openMaster | [openMaster-VST3-macOS.zip](https://github.com/alanmarcero/openMaster/releases/download/v1.0.1/openMaster-VST3-macOS.zip) | arm64 + x86_64 | `77bf6c64674a56e4b94d29f76568ac90c846bc0209e3b5d7504068f8a1f7b284` |
| openMaster | [openMaster-VST3-Windows.zip](https://github.com/alanmarcero/openMaster/releases/download/v1.0.1/openMaster-VST3-Windows.zip) | x86_64 | `c2a7dd68a389dcb138f2f5ec6ace1686fb887e8b65137a2a15919b67ad366d78` |
| winamp-classic-equalizer-vst | [WinampClassicEqualizer-VST3-macOS.zip](https://github.com/alanmarcero/winamp-classic-equalizer-vst/releases/download/v1.0.0/WinampClassicEqualizer-VST3-macOS.zip) | arm64 + x86_64 | `7fa00a38c8d41b929f9b557e30bdcda76888716a89ada01288b355aa01fb2668` |
| winamp-classic-equalizer-vst | [WinampClassicEqualizer-VST3-Windows.zip](https://github.com/alanmarcero/winamp-classic-equalizer-vst/releases/download/v1.0.0/WinampClassicEqualizer-VST3-Windows.zip) | x86_64 | `20d2f64d337926caf302e907ad1c9f7b63dae37f216b73a73cb9eae23f268ad6` |
| winamp-classic-visualizer-vst | [WinampClassicVisualizer-VST3-macOS.zip](https://github.com/alanmarcero/winamp-classic-visualizer-vst/releases/download/v1.0.0/WinampClassicVisualizer-VST3-macOS.zip) | arm64 + x86_64 | `31a12bf4dbc3adb97dc26b79d41243054008902d3f1285a690d4b79295d3083b` |
| winamp-classic-visualizer-vst | [WinampClassicVisualizer-VST3-Windows.zip](https://github.com/alanmarcero/winamp-classic-visualizer-vst/releases/download/v1.0.0/WinampClassicVisualizer-VST3-Windows.zip) | x86_64 | `7ab011214e7a6bbdf4ff01d306f4545d593658fca5ad022a61e9c9dc1f45f4b6` |

## Verification

- Native jobs passed unit tests and pluginval at strictness 5 before publication. openEDMFilter also passed its Linux build and 38 tests. openSausage and openTunerEQ retained and passed Linux sanitizer jobs.
- Anonymous HTTPS downloads matched GitHub asset sizes and SHA-256 digests. Every ZIP passed CRC checks and contained its VST3 bundle, JUCE notices, and a source link at the exact commit.
- macOS VST3 binaries contain both arm64 and x86_64 slices. Extracted bundles passed `codesign --verify --deep --strict`. These are ad hoc signatures; the binaries are not notarized.
- Windows VST3 files have the x86_64 PE machine type. Existing project license text was preserved, allowing the Windows checkout’s CRLF line endings.
- Existing archive names and format layouts were retained. openSausage keeps its `package/VST3`, `package/AU`, and `package/Standalone` layout; the other packages keep formats at the archive root.

## Changes and remaining licensing limits

- Added tag-based publishing to openGlitchFX, openMaster, and the two Winamp plugins. Retained the existing release pipelines for openEDMFilter, openSausage, and openTunerEQ. All release gates remain in place.
- Added packaging of existing project and JUCE dependency notices, with an exact source link. Windows configuration now explicitly targets x64 where it previously relied on the default.
- Fixed openEDMFilter’s Windows/Linux compile failure by adding the missing `<algorithm>` include used by `std::ranges::transform`.
- Published openMaster as 1.0.1 and preserved the earlier 1.0.0 release. All work used fresh checkouts under `openvst-release-work`; the original plugin working directories were not modified.
- The Winamp repositories have no project LICENSE file. Their READMEs describe independent redevelopment without redistributed Winamp code. No project license was invented or changed. JUCE retains its upstream AGPL/commercial terms, and its notices are included.

No build or download blockers remain. The Winamp source-license omission remains documented above.

## openDucker addition — 2026-10-21

[openDucker v1.0.0](https://github.com/alanmarcero/openDucker/releases/tag/v1.0.0) was built from [a0e9869](https://github.com/alanmarcero/openDucker/tree/a0e9869ddd6bb3a641f080057878bcc1e077cf93). [CI passed](https://github.com/alanmarcero/openDucker/actions/runs/39624213765): Linux address/undefined sanitizers, macOS universal and Windows x64 builds, native controls/state/audio tests, and pluginval level 5 on both platforms. Project license: AGPL-3.0.

| Asset | Architecture | SHA-256 |
| --- | --- | --- |
| [openDucker-macOS-universal.zip](https://github.com/alanmarcero/openDucker/releases/download/v1.0.0/openDucker-macOS-universal.zip) | arm64 + x86_64, VST3 + AU | `10833ed12166efbaee2d34df67283034499ddcef260758fda248c3a95b617f0c` |
| [openDucker-Windows-x64.zip](https://github.com/alanmarcero/openDucker/releases/download/v1.0.0/openDucker-Windows-x64.zip) | x86_64, VST3 | `16eeff48c70b9ad4ba097d0ac2687ff506262a91a718d026b31eff5c0181fc4c` |

The real manager service downloaded these public assets without authentication, checked their GitHub SHA-256 digests, installed each format into isolated folders, detected managed v1.0.0 receipts, and removed the bundles cleanly. Extracted macOS bundles passed strict code-signature verification and contained both architecture slices. The Windows archive passed the same installer path with Windows platform selection on macOS, and its PE header was verified as x64; actual Windows execution was validated by CI. No user plugin folders were changed by this installation test.

Catalog integration passed 63 core tests, TypeScript/production build, and nine browser UI tests. Existing manager releases refresh this public catalog; a new manager binary is not required.
