# Animation sampler: WASM API and recovered rules

This page is for contributors working on animation sampling. For normal use,
start with the [animated preview guide](wasm-preview.md). All native addresses
and recovered behavior below refer to MSM PC **5.7.0**.

An AEAnim resource stores animation layers and keyframes. A sparse property
track only records keys for a particular property when that property changes.
The sampler evaluates those tracks at a requested asset time.

Implemented in `runtime/ae_sampler.c`, built to
`public/runtime/ae-sampler.wasm`, wrapped by `src/lib/wasmAeSampler.ts`.
The module evaluates recovered sampling rules. The [animated preview](wasm-preview.md)
uses its poses in Canvas2D; rendering, entity behavior and the native animation
controller are separate components. The static map remains the default.

## Native evidence (MSM PC 5.7.0)

`0x64E550` turns the on-disk interleaved records into separate property tracks.
It tests the low byte of each property's flag. `255` omits that property key;
`0` becomes interpolation mode 1; any other non-255 flag becomes mode 0 (hold).

| On-disk field | Meaning |
| --- | --- |
| word 0 | float time |
| word 1 / words 2,3 | position flag / float X,Y |
| word 4 / words 5,6 | scale flag / float X,Y percentages |
| word 7 / word 8 | rotation flag / float degrees |
| word 9 / word 10 | opacity flag / float percentage |
| word before sprite string | sprite-index interpolation flag (low byte) |
| word after sprite string | color flag (low byte), red, green, blue bytes |

The last word is **not just a signed sentinel**: `-1` has flag 255 and therefore
omits a color key. A color key packs the three color bytes above its flag.
Likewise, omitted property payloads contain zeros, not meaningful new poses.

Native numeric paths:

- `0x4D4610` searches XY tracks; `0x4CD5E0` holds or interpolates them.
- `0x4D4800` searches scalar tracks; `0x4CD490` holds or interpolates them.
- `0x4CCED0` searches RGB tracks; `0x4C99B0` holds or interpolates them.
- Before the first key / for empty numeric tracks, XY/scalar default to zero,
  RGB to 255. After the last key they hold its value. Each track has its own
  timestamps; unrelated property records must not interrupt interpolation.
- Scalar interpolation uses `(difference * elapsed) / duration + start`;
  XY/RGB use `difference * (elapsed / duration) + start`. The build disables
  floating-point contraction/fast math to preserve this distinction.
- Rotation interpolation is ordinary scalar interpolation, not shortest-arc
  interpolation.
- `0x4CC960` resolves sprite names to atlas indices and, in linear mode, adds
  a **truncated signed interpolated difference** to the starting index. A
  browser host must resolve names to the original atlas ordering before using
  `sampleAtlasIndex`; lexicographically sorting names is incorrect.

`0x64F060` computes composition duration as the maximum layer end time;
`0x64E550` takes layer start/end from the first/last record time. The animation
header float goes to the composition loop-start field. `0x4CB770` handles the
controller's looping and completion events; that stateful controller has NOT
been ported here. Asset timestamps observed in the installed rigs include
1/30-second steps, but this sampler accepts native asset time directly and
performs no FPS conversion or looping.

## Build and use

Run from `msm-re/msm-state` after [installing dependencies](../README.md#requirements).

```sh
npm run build          # TypeScript + WASM
npm test               # rebuilds and runs all tests, including actual WASM
```

Requires LLVM clang with the wasm32 backend and wasm-ld. The build probes
`WASM_CLANG`, Homebrew LLVM, then `clang` on PATH. This small freestanding module
uses an existing LLVM installation and does not require Emscripten. It has no imports,
heap or memory growth; the capacity is 4096 records per layer.

Browser diagnostic use (a parsed layer must be supplied by the caller):

```js
const { WasmAeSampler } = await import('/api/runtime/ae-sampler.js');
const bytes = new Uint8Array(await (await fetch('/api/runtime/ae-sampler.wasm')).arrayBuffer());
const sampler = await WasmAeSampler.create(bytes);
const pose = sampler.sample(layer, nativeTime);
```

These two exact HTTP routes expose our module only. There is no new general
asset route or game login. The wrapper has no Node runtime imports and can also
be used in Node offline tests. Instances own scratch memory; sampling is
synchronous and results are copied out, so later samples cannot mutate earlier
poses. A null sprite result means no sprite key is active, not an instruction
to clear the host's initial sprite.

### ABI version 1

The application binary interface (ABI) defines the values exchanged between
the host wrapper and the WASM module.

- `ae_abi_version()` → 1; `ae_capacity()` → 4096.
- `ae_input()` → pointer to the fixed input arena.
- Each input record has 13 little-endian u32 words: the original eleven words,
  the word before the sprite string, the word after it. Sprite strings remain
  in the host; the sampler returns record indices.
- `ae_sample(count, time)` → 0; -1 invalid count/time; -2 nonfinite or descending
  timestamps; -3 nonfinite keyed numeric payload. Invalid input leaves the
  output unchanged. Equal timestamps are allowed; the last key at an exact
  boundary wins.
- `ae_output()` → 18 float32 values: six three-float slots for position,
  scale percentages, rotation, opacity, RGB, and sprite `(fromRecord,
  toRecord, fraction)`. Unused numeric components are zero.

The wrapper converts scale percentages to factors and validates metadata and
ABI bounds. The native module also bounds counts and validates numeric input;
it is not a general arbitrary-pointer API.

## Verification and remaining work

Tests execute the compiled WASM, not a JS substitute. Synthetic fixtures cover
sparse tracks, interpolation/holds, exact/duplicate boundaries, reverse seeks,
missing tracks, rotation, RGB, sprite index arithmetic and malformed input.
Installed monster A/B, breeding structure and Plant scene clips are sampled at
multiple timestamps, with first-key pose checks. HTTP tests instantiate WASM
from the served response and verify the route allowlist.

The wrapper also offers `prepare(layer)`, which snapshots validated record
words and sprite names once and returns a synchronous time evaluator. The
preview uses prepared resources rather than revalidating JS objects each frame;
the WASM core continues to validate its bounded input arena on every call.

This establishes native-code-informed rules and asset compatibility, **not
measured native frame/audio parity**. We have not executed the native sampling
functions as a golden oracle. Parent/anchor transforms, atlas trim/rotation,
visibility, blend modes, costumes/remaps, controller clip queues, event delivery,
MIDI triggers and audio-clock scheduling are still outside this component.
Browser preview integration now exists, but its Canvas2D/parent-placement
adapters remain experimental. Native frame and audio comparisons are needed
before claiming equivalent playback. See the [runtime roadmap](wasm-runtime.md)
and [rig transform notes](rig-transforms.md) for the next steps.
