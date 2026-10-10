# Terrain geometry and empty scenery layers

This contributor note explains two rendering rules used by both the static map
and the [animated preview](wasm-preview.md): diamond-shaped ground tiles and
valid scenery layers without active sprite keys. Evidence addresses refer to
MSM PC **5.7.0** and must be rechecked for other versions.

## Why ground tiles are diamonds

The texture crop is rectangular, but the visible ground tile is a diamond.
Native grid setup `0xCDFBF0` resolves tile graphics through `0xDBE420`, which
constructs `game::gfx::GfxDiamondSprite`. Its draw method (`0xE78580`) passes
a transformed quad and texture-coordinate bounds to `0x550A00`. That routine
uses the quad's edge midpoints for geometry and texture coordinates, then emits
two triangles.

`IslandDraw.shape = 'diamond'` marks terrain draws. The Canvas adapter clips
its affine texture draw to those four edge midpoints. Cell picking and entity
placement retain their existing coordinate system.

Canvas antialiases each clipped tile independently, which can leave transparent
hairline seams at shared edges. A small screen-space coverage guard reduces
those seams. Native GPU pixel coverage, including borders and crops, still
needs reference-frame comparison.

## Layers with no active sprite

An animation rig is a hierarchy of layers. A layer can carry a transform
without drawing visible art. Plant Island's `prop_clubbox` and `eye_node` use
`empty.xml`, whose atlas has one transparent sprite named `empty`. Their
`beforeSprite` low byte is `255`, so they have no active sprite key.

Native `0x4CC960` leaves the sheet's current selection unchanged when no key
has become active. The deterministic preview uses initial sheet index zero
instead of looking up an empty string or node name. This keeps transforms and
parent relationships intact and avoids falling back for the entire Plant scene.

Retaining sprite state across native seeks and clip queues remains part of the
pending controller work; see the [runtime roadmap](wasm-runtime.md).

## Verification

Unit tests cover real Plant grass crop sizes, diamond tags, absent sprite keys
and WASM scenery animation. The optional offline Chromium checks inspect pixels
for transparent tile corners, drawn interiors and opaque shared edges.

Run checks using the [preview verification instructions](wasm-preview.md#verification).
Asset-dependent checks require local game files; they do not establish complete
native renderer equivalence.
