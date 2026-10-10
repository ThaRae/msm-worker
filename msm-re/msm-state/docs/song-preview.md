# Song preview with original game samples

The dashboard can play one island MIDI arrangement using samples from your
local game installation. It is an experimental listening preview. Native
adaptive loops and singing-clip synchronization are still unfinished.

## Try it

Complete [package setup](../README.md#quick-start), including the local asset
requirements, then run from `msm-re/msm-state`:

```sh
npm run build
node dist/cli.js watch
```

Open an island, select **Try WASM preview**, then **Play original samples**.
Playback requires your click; it does not autoplay. The existing dashboard
session supplies account state, and playback creates no additional game login
or gameplay request.

Only owned, unmuted monsters outside the hotel and the castle bass are included.
Unsupported instruments stay silent and produce diagnostics. Game audio is
read locally and is not included in the repository.

## What to expect

The preview plays one complete MIDI arrangement. Idle/catalog animation follows
the audio clock, but notes do not yet select the corresponding singing clips.
Duplicate instrument descriptors play once. Native duplicate balancing,
spatial placement, time-machine tuning, costumes and special controllers remain
unimplemented.

Hidden pages pause both clocks. Refreshes and art-only layout changes preserve
playback. Changes to participating monsters or mute state stop it and require
a new click. Leaving the page aborts loads, stops sources, closes the audio
context and releases samples. If scheduling stalls, missed notes are skipped
rather than played in a burst. Audio errors leave the map available.

## Recovered scheduling rules

All addresses and asset findings here refer to MSM PC **5.7.0**.

- `src/lib/gameInstrument.ts` parses `budd` instrument descriptors from
  `xml_bin`. Readers `0xB36F40` and `0xB37260` establish padded strings,
  sample records and animation mappings. Unknown words retain their raw values.
- `src/lib/gameMidi.ts` reads format-0/1 Standard MIDI Files (SMF), including
  track names, notes, running status, tempos, markers and end times. The preview
  uses named format-1 tracks.
- Native `MidiFile::load` (`0x4C37B0`) retains the last encountered tempo.
  Note-on is stored at `(tick + 1) / PPQ`; note-off, including zero-velocity
  note-on, at `(tick - 1) / PPQ`. PPQ is ticks per quarter note. Bracket markers
  are unshifted. The adapter uses float32 beats and seconds.
- Catalog rows map content IDs to descriptors, whose names select MIDI tracks.
  The sample record's low byte selects a note. `0xB33630` installs sample slots
  and `0x4C5AB0` selects them. Exact-key notes use unit pitch; unsupported
  transposition cases are rejected. Native velocity is divided by 100.

## Browser implementation

`GET /api/islands/:id/runtime` can include a version-1 song program.
`/api/audio/music/<basename>.ogg` serves allowlisted original game audio.
`src/lib/songPreview.ts` uses Web Audio, preloads at most four files at a time,
bounds compressed/decoded sizes and schedules 200 ms ahead against `AudioContext`.
Master volume is 35%; note-off applies a 20-ms linear fade.

MIDI parsing, event planning and Web Audio are TypeScript components. WASM
currently evaluates sparse animation tracks only. Native fade curves, mixing,
adaptive bracket/gap skipping, clip queues and loop seeks are not reproduced.

## Verification

Tests cover MIDI/instrument parsing, malformed data, owned/muted filtering,
native timing offsets, scheduling stalls, decode failures and cleanup. Local
asset checks cover the 43 MIDI files in the inspected installation and Potbelly
sample mappings. The optional browser check verifies nonzero original-sample
output, pause/resume, refresh preservation and navigation cleanup.

See [preview verification](wasm-preview.md#verification) for commands and asset
requirements. Native captured-audio and synchronized frame comparisons are
still needed before claiming equivalent game playback.
