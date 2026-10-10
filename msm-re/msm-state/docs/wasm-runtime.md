# Island runtime roadmap

This page is for contributors extending the experimental browser runtime.
For using the current features, see [animated preview](wasm-preview.md) and
[song preview](song-preview.md).

The goal is animation and audio whose behavior can be measured against MSM PC
**5.7.0**. The project has a reverse-engineered implementation, not the game's
native source. Executables, disassembly databases and game assets are local
research inputs and are not distributed in the repository.

## Current status

| Component | Status |
| --- | --- |
| Static map | Default renderer, using local game art and rest poses. |
| Sparse animation sampling | Freestanding C module compiled to WASM; [API and rules](ae-sampler.md). |
| Animated map | Opt-in Canvas2D preview with prepared clips and fallback diagnostics. |
| Parent transforms and hires atlases | Specific recovered rules implemented; [alignment notes](rig-transforms.md). |
| Terrain | Diamond geometry and empty scenery layers implemented. |
| Original-sample audio | One MIDI arrangement with Web Audio scheduling. |
| Native adaptive song/clip controllers | Not yet ported. |
| WebGL shaders, meshes and particles | Not implemented. |
| Native frame/audio equivalence | Not established. |

The current WASM module builds with LLVM `clang` and `wasm-ld`; Emscripten is
not required. Future components may need a larger, pinned toolchain. Installed
Lua scripts may be useful, but their bindings and version compatibility need
an audit before reuse.

## Data and implementation boundaries

`aeAnim.ts` retains animation headers, layer metadata, eleven keyframe words
and the words around sprite names. Its rest-pose evaluator uses the first
frame; the preview evaluates recovered sparse tracks separately. Unknown
fields remain raw until their meaning is established.

`gameAssets.ts` builds a flattened static draw list. Playback also needs
per-entity clip selection, animation instances and visual/audio state, so that
draw list alone cannot define a complete runtime. The current dashboard draws
through Canvas2D.

The inspected installation contains `xml_bin`, `xml_resources`, Lua scripts,
shaders, particles, 43 MIDI files and per-monster OGG samples. The presence of
those files does not establish their scheduling or playback rules.

## Native research anchors

Addresses refer to the inspected 5.7.0 Windows executable. Cross-references
(xrefs) point to code that refers to a string or symbol. These are investigation
starting points, not complete specifications.

| Address | Observation |
| --- | --- |
| `0x1211B20` | `sys/src/gfx/AEAnim.cpp` source-path string with runtime xrefs |
| `0x1222198` | `sys/src/res/ResourceAEAnim.cpp` source-path string |
| `0x5EA7E0` | Resource reader: sources followed by animation records |
| `0x5EACA0` | Animation reader: 12 header bytes after the name; layer metadata; 44 keyframe bytes, a word, a string, a final word |
| `0xA40870` | Lua `AEAnim_setTime` binding: marks the object dirty and dispatches to its animation controller |
| `0xA404D0` | Lua `AEAnim_duration` binding: reads duration from the controller's composition |
| `0x1211938`–`0x12119C0` | `MidiFile::stop`, `deleteActive`, `stopTrackSounds`, `setTrackPitch`, `setTrackPosition`, `duplicateTrack` strings |

Decompilation can misrecover stacks and calling conventions. Check conclusions
against disassembly and local asset fixtures. Do not assume every keyframe word
is a float or that frame numbers are time in seconds.

## Proposed architecture

| Component | Responsibility |
| --- | --- |
| WASM core | Recovered resource/track rules, animation instances, parent transforms, clip queues and deterministic events. |
| Browser graphics adapter | Texture uploads, draw batches, camera, picking, blend behavior and context-loss recovery. |
| Browser audio adapter | Schedule original samples against a shared audio clock; evaluate whether native mixing needs an AudioWorklet. |
| Node state/asset bridge | Versioned account snapshots, stable instance IDs and bounded routes for local rigs, textures, MIDI and audio. |

Authentication and the persistent, read-only game session stay in Node.
Rendering must not create an extra login or send game requests on its own. Game assets remain local and read-only.
Version interfaces as their semantics become known rather than treating a
rest-pose format as sufficient for full playback.

## Remaining work

### 1. Establish native references

Capture synchronized native frames and audio with the executable/asset version,
island, entity state, clip/song position, viewport and camera recorded. Start
with Plant Island, a simple structure, Mammott and a parented/rotated rig.
Prefer offline fixtures; live logins can displace another session.

Recover controller updates, time units, loops, completion events, visibility,
blend modes and clip transitions. Check song tracks, note/sample mapping,
duplicates, mute, gain and pitch against native code and scripts.

### 2. Extend the core with comparisons

Keep a reproducible build and compare sampled poses at exact times, including
boundaries and parent chains. Current WASM tests cover synthetic and installed
fixtures; they do not execute native sampling as a golden reference. Explicit
unsupported-record fallbacks make limitations visible but do not prove parity.

### 3. Complete rendering integration

The opt-in Canvas2D endpoint/client module and offline browser checks already
exist. Parent/atlas corrections are implemented for ordinary supported layers;
full placement, sprite ordering and native comparisons remain. A WebGL adapter
must account for shaders, mesh data and blend behavior.

Preserve picking, placement entry, tooltips and hotel/warehouse exclusion.
Keep resource disposal, stale-load cancellation, visibility behavior and failed
asset handling independent of dashboard DOM refreshes.

### 4. Connect audio to entity behavior

The current original-sample preview plays a full arrangement. Next recover
adaptive song loops and connect notes to singing clips. Keep one shared song
origin, user-gesture sound activation and audio-clock scheduling.

Verify duplicates, mute changes, time-machine tuning, background tabs,
costumes, inactive monsters, structures, clubboxes and island-specific modes
with native references. Surface unsupported behavior in diagnostics.

### 5. Validate before changing the default

Acceptance requires documented comparisons for:

- sprite selection, transforms, opacity and ordering, with numerical tolerances;
- camera-matched screenshots across ordinary and special rigs, atlas rotation,
  costumes and mirrors;
- note events, sample starts, tempo, gain, pitch and loop boundaries without
  accumulating drift;
- clocks surviving polling/refresh and resources releasing on navigation;
- missing assets, failed loads, resize and graphics/audio lifecycle;
- absence of extra logins or unintended gameplay mutations.

Publish supported versions and remaining exceptions alongside results. Native
compatibility needs measurements; compiling a component to WASM alone does
not establish it.
