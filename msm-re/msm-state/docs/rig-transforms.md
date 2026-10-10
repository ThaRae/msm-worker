# Rig alignment and texture density

This contributor note explains how the preview positions connected sprite
layers and handles high-resolution texture atlases. A **rig** is a hierarchy of
animation layers; an **atlas** packs several sprite images into one texture.
An **anchor** is the local point around which a layer is positioned and rotated.

These rules come from MSM PC **5.7.0**. They apply to the static rest pose and
[WASM animation preview](wasm-preview.md), but have not been compared against
a complete set of native reference frames.

## Problems corrected

| Problem | Visible effect | Correction |
| --- | --- | --- |
| Parent transforms omitted anchor compensation | Connected parts separated along deep parent chains, such as Potbelly's head and mouth. | Compose each parent's anchor-adjusted transform. |
| `hires="true"` atlas density was ignored | Parts and trim offsets appeared twice as large. | Keep physical texture crops but halve logical dimensions and offsets. |

## Parent and child transforms

Native `0x4CED20` evaluates parents recursively. `0x4CC960` adjusts the sprite
anchor for the crop and logical trim offset. On the child path, parent trim
cancels out, leaving the parent's untrimmed, anchor-adjusted coordinate space.
For ordinary supported sprite layers:

```text
local = T(position) R(rotation) S(scale) T(-anchor)
world = parentWorld * local
```

`T`, `R` and `S` mean translation, rotation and scale; multiplication composes
those transforms. Trim offsets affect sprite drawing, not the hierarchy.
Parent rotation and nonuniform or negative scale therefore affect child
positions and anchors. The native routine's degree negation and opposite sine
signs produce the rotation convention used by Canvas.

## High-resolution atlases

The native routines halve sprite-sheet offsets when the hires flag is set.
The browser keeps physical crop coordinates for `drawImage`, then applies
`pixelScale = 0.5` to destination dimensions, logical trim positions and packed
rotation offsets. Untrimmed dimensions scale the same way. A layer's declared
size must not replace the sprite's logical dimensions.

## Verification and remaining limits

Synthetic tests cover ancestor anchors, mirroring and nonuniform scale.
Local Potbelly fixtures cover physical crops, logical sizes and rotated mouth
trim offsets. The [offline browser check](wasm-preview.md#verification) writes
`rig-alignment.png`, a magnified diagnostic image for inspecting connected parts.

Placement, sprite-index ordering, special layer types and gameplay clip
selection still need native comparison. These fixes recover specific transform
rules; they do not establish full renderer equivalence.
