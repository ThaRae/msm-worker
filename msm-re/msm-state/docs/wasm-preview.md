# Animated island preview

The dashboard has an optional animated map using a WebAssembly (WASM) sampler
and Canvas2D drawing. The sampler evaluates recovered game animation rules;
the rest of the renderer remains browser code. The static map is still the default.

## Try it

Complete [package setup](../README.md#quick-start), including the local game
asset requirements. Run from `msm-re/msm-state`:

```sh
npm run build
node dist/cli.js watch
```

If the dashboard was already running before the build, restart it. Open
**http://127.0.0.1:7331**, select an island, then click **Try WASM preview**.
**Use static map** switches back. A direct link is also available:

```text
http://127.0.0.1:7331/?renderer=wasm#/island/YOUR_USER_ISLAND_ID
```

Replace the placeholder with an island instance ID from your account. Map
cell picking uses the same coordinate system in both modes. Enabling the
preview creates no additional game login or game request; the running
dashboard still uses its normal live session.

The status below the map reports animated instances. Hover it for unsupported
features and fallback reasons. **Play original samples** enables the optional
[song preview](song-preview.md).

## Supported behavior and fallback

| Feature | Current behavior |
| --- | --- |
| Animation tracks | Prepared layers evaluated by the compiled WASM sampler; shared clips sampled once per frame. |
| Sprite drawing | Canvas2D handles crops, trim, rotation, scale, flip and opacity. |
| Parent alignment and hires textures | Recovered rules applied; see [rig transforms](rig-transforms.md). |
| Terrain and empty scenery layers | Diamond ground tiles and valid empty nodes; see [terrain notes](terrain-preview.md). |
| Clip timing | Asset timestamps, clamped nonlooping clips and metadata-based loops. |
| Unsupported rigs or failed resources | Keep the static rig/map and display diagnostics. |
| Hotel monsters and warehouse structures | Excluded from the scene. |

Nested, sound, particle, tinted and non-normal-blend rigs remain static.
A sprite-resolution failure falls back for the affected rig. Module or WASM
loading failures keep the static map available.

Animation runs at up to 30 Hz. Its time origin survives dashboard refreshes
and layout rebuilds. Hidden-page time is excluded; navigation or pagehide
stops the loop and releases resources. Aborted or stale loads cannot replace
the currently selected island.

## Accuracy limits

The recovered rules and native addresses refer to MSM PC **5.7.0**. Updates
can change them. The preview has not established native frame or audio parity:

- Atlas banks preserve XML ordering; native sprite-index ordering still needs
  comparison.
- Selected catalog clips do not follow singing, sleeping, costumes, structure
  lifecycle or the complete native visual state.
- Original samples can play a MIDI arrangement, but native adaptive loops,
  singing-clip queues and completion events are unfinished.
- WebGL shaders, meshes and particles are not implemented.
- Full entity placement and representative native screenshots still need
  validation.

The [runtime roadmap](wasm-runtime.md) describes the remaining work and the
checks required before changing the default renderer.

## Verification

From the package directory:

```sh
npm test
```

The suite exercises compiled WASM, timing, transforms, hires crop/trim geometry,
prepared resources, instance placement, opacity, fallback and HTTP routes.
Some checks use local installed rigs or require localhost networking.

The optional offline browser smoke test needs local game assets, catalogs,
Playwright and its Chromium browser. It uses synthetic player state and does
not open a game session:

```sh
npm run test:renderer
```

If Playwright is installed elsewhere, point to its module:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:renderer
```

Checks include rendered animation, picking, preserved clocks, original-sample
audio, visibility pause/resume, cleanup and failed-WASM fallback. Output includes
`artifacts/wasm-preview.png` and `artifacts/rig-alignment.png` by default;
`PREVIEW_ARTIFACT_DIR` can select another directory. These images contain local
game art and are diagnostic output; review them before sharing.

## Implementation entry points

`GET /api/islands/:id/runtime` returns the static scene plus versioned clips,
keyframe metadata, texture banks and entity IDs. `src/lib/animationPreview.ts`
prepares layers and integrates the sampler. See the [sampler API](ae-sampler.md)
for its ABI and recovered interpolation rules.
