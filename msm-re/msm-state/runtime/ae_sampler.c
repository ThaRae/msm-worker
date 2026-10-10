/* MSM PC 5.7.0 AE sparse track sampler.
 * Evidence: Resource conversion 0x64E550; XY 0x4D4610/0x4CD5E0;
 * scalar 0x4D4800/0x4CD490; color 0x4CCED0/0x4C99B0;
 * sprite index 0x4CC960. See docs/ae-sampler.md for scope and ABI.
 * No native binary code/assets are included. No libc, heap or browser imports.
 */
typedef unsigned int u32;
#define CAPACITY 4096
#define STRIDE 13
static u32 records[CAPACITY * STRIDE];
/* Channels: position XY, scale XY%, rotation degrees, opacity%, RGB,
 * sprite record indices + interpolation fraction (atlas resolution is host-side).
 * Each output occupies three floats. */
static float output[18];

unsigned int ae_abi_version(void) { return 1; }
unsigned int ae_capacity(void) { return CAPACITY; }
u32 *ae_input(void) { return records; }
float *ae_output(void) { return output; }
static float decode(u32 word) { union { u32 u; float f; } v; v.u = word; return v.f; }
static int finite(float f) { union { u32 u; float f; } v; v.f = f; return (v.u & 0x7f800000u) != 0x7f800000u; }
static unsigned int flag(unsigned int i, unsigned int channel) {
  static const unsigned int offsets[6] = {1, 4, 7, 9, 12, 11};
  return records[i * STRIDE + offsets[channel]] & 255;
}
static float value(unsigned int i, unsigned int channel, unsigned int component) {
  static const unsigned int offsets[4] = {2, 5, 8, 10};
  if (channel == 4) return (float)((records[i * STRIDE + 12] >> (8 * (component + 1))) & 255);
  return decode(records[i * STRIDE + offsets[channel] + component]);
}

/* Returns 0 on success, -1 invalid count/time, -2 invalid/nonmonotonic key
 * time, -3 nonfinite keyed numeric value. Output only changes on success. */
int ae_sample(unsigned int count, float time) {
  if (count > CAPACITY || !finite(time)) return -1;
  float previous = 0;
  for (unsigned int i = 0; i < count; ++i) {
    float t = decode(records[i * STRIDE]);
    if (!finite(t) || (i && t < previous)) return -2;
    previous = t;
    for (unsigned int c = 0; c < 4; ++c) {
      if (flag(i, c) == 255) continue;
      unsigned int components = c < 2 ? 2 : 1;
      for (unsigned int j = 0; j < components; ++j)
        if (!finite(value(i, c, j))) return -3;
    }
  }
  for (unsigned int c = 0; c < 6; ++c) {
    float *out = output + c * 3;
    out[0] = out[1] = out[2] = c == 4 ? 255.0f : 0.0f;
    if (c == 5) out[0] = out[1] = -1.0f;
    int from = -1, to = -1;
    for (unsigned int i = 0; i < count; ++i) {
      if (flag(i, c) == 255) continue;
      if (decode(records[i * STRIDE]) <= time) from = (int)i;
      else { to = (int)i; break; }
    }
    if (from < 0) continue;
    float fraction = 0;
    if (to >= 0 && flag((unsigned int)from, c) == 0) {
      float start = decode(records[(unsigned int)from * STRIDE]);
      float end = decode(records[(unsigned int)to * STRIDE]);
      fraction = (time - start) / (end - start);
    }
    if (c == 5) {
      out[0] = (float)from;
      out[1] = (float)(to < 0 ? from : to);
      out[2] = fraction;
      continue;
    }
    unsigned int components = c < 2 ? 2 : (c == 4 ? 3 : 1);
    for (unsigned int j = 0; j < components; ++j) {
      float a = value((unsigned int)from, c, j);
      if (to >= 0 && flag((unsigned int)from, c) == 0) {
        float b = value((unsigned int)to, c, j);
        /* Scalar native path multiplies then divides; XY/RGB divides first. */
        if (c == 2 || c == 3) {
          float start = decode(records[(unsigned int)from * STRIDE]);
          float end = decode(records[(unsigned int)to * STRIDE]);
          out[j] = ((b - a) * (time - start)) / (end - start) + a;
        } else out[j] = (b - a) * fraction + a;
      } else out[j] = a;
    }
  }
  return 0;
}
