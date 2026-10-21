# Plugin release audit

Audit date: 2026-10-21. Tagged builds are in progress; asset verification is pending.

| Repository | Tag / source | Build | Project license |
| --- | --- | --- | --- |
| [openGlitchFX](https://github.com/alanmarcero/openGlitchFX) | [v1.0.0 / 8934bd2](https://github.com/alanmarcero/openGlitchFX/tree/8934bd2cd69eae12f5db1c61045d5ec60867d6cd) | [Tagged build](https://github.com/alanmarcero/openGlitchFX/actions/runs/39607551644) | MIT |
| [openEDMFilter](https://github.com/alanmarcero/openEDMFilter) | [v0.1.0 / dacfbaf](https://github.com/alanmarcero/openEDMFilter/tree/dacfbafe2fea72887179601cf653e56b42520936) | [Tagged build](https://github.com/alanmarcero/openEDMFilter/actions/runs/39607561635) | MIT |
| [openSausage](https://github.com/alanmarcero/openSausage) | [v1.0.0 / 84f5834](https://github.com/alanmarcero/openSausage/tree/84f5834a00ee58a4d92aab7b874173f9dd4c009c) | [Tagged build](https://github.com/alanmarcero/openSausage/actions/runs/39607570914) | AGPL-3.0 |
| [openTunerEQ](https://github.com/alanmarcero/openTunerEQ) | [v1.0.0 / 326266e](https://github.com/alanmarcero/openTunerEQ/tree/326266e1e486b353f1e488cf75fcca579d8f05cb) | [Tagged build](https://github.com/alanmarcero/openTunerEQ/actions/runs/39607588737) | AGPL-3.0 |
| [openMaster](https://github.com/alanmarcero/openMaster) | [v1.0.1 / 35ce5ed](https://github.com/alanmarcero/openMaster/tree/35ce5ed9bd3fe223b2e82e9a8dac82b5ba158bf7) | [Tagged build](https://github.com/alanmarcero/openMaster/actions/runs/39607641103) | MIT |
| [winamp-classic-equalizer-vst](https://github.com/alanmarcero/winamp-classic-equalizer-vst) | [v1.0.0 / 0c3d34b](https://github.com/alanmarcero/winamp-classic-equalizer-vst/tree/0c3d34bebffb415b1f7547af525ea83a8f5af667) | [Tagged build](https://github.com/alanmarcero/winamp-classic-equalizer-vst/actions/runs/39607605155) | No project LICENSE file |
| [winamp-classic-visualizer-vst](https://github.com/alanmarcero/winamp-classic-visualizer-vst) | [v1.0.0 / 50da2f9](https://github.com/alanmarcero/winamp-classic-visualizer-vst/tree/50da2f948ceac7268c2baa1ca7f0ad56a76d7015) | [Tagged build](https://github.com/alanmarcero/winamp-classic-visualizer-vst/actions/runs/39607614204) | No project LICENSE file |

All existing unit-test and pluginval jobs remain release prerequisites. openEDMFilter also retains its Linux build; openSausage and openTunerEQ retain Linux sanitizer tests.

Each package now copies the existing project license and notices, JUCE 8.0.9 dependency notices, and a source link at its exact commit. The Winamp repositories have no project LICENSE file; their READMEs describe independent redevelopment without redistributed Winamp code. No source license was added or changed. JUCE retains its upstream AGPL/commercial licensing terms.

The macOS builds use arm64 and x86_64 and are ad hoc signed, not notarized. Windows builds explicitly target x64.

openEDMFilter’s latest Windows and Linux builds previously failed because Oversampler.cpp used std::ranges::transform without including <algorithm>. The release commit adds that include. openMaster is bumped to 1.0.1 to preserve its existing 1.0.0 release.
