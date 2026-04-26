# Auriculate — Merged Build

All logic is now inside `index.html` (one self-contained file). `main.js` is no
longer used; `main_legacy.js` is kept here only as a reference to the previous
standalone Phase 8 implementation.

## How to run

From this folder, in a terminal:

```
npx serve
```

Then open the URL it prints (usually `http://localhost:3000`) in Chrome.

## What's in this build

- Friend's design preserved: intro screen, loader, 3D particle background,
  tutorial overlay, scene switcher (forest / rain / fire), DM Mono / DM Serif
  typography, glassy panel layout.
- Phase 8 logic preserved: two-handed control, debounced gesture detection,
  Ambience / SFX layer system, both-thumbs-up/down to switch layers,
  press-to-trigger SFX (no rapid retrigger), volume lock when right hand
  leaves frame in Ambience layer, head-height volume mapping.

## Layer system

- **Ambience layer (default):** index→wind, peace→rain, three→thunder,
  pinky→birds, fist→silence
- **SFX layer:** OK→dog, index→guzhen, peace→footsteps, three→door knock,
  fist→silence
- **Both hands 👍👍**: Ambience → SFX
- **Both hands 👎👎**: SFX → Ambience

## Volume

- Left hand height controls volume. Raise to head height for max.
- In Ambience layer: drop the right hand while a sound is playing → volume
  bar turns red and freezes. The sound keeps playing hands-free. Show the
  same gesture again to unlock.
- In SFX layer: left hand controls the most recently triggered SFX's volume.
  No lock in this layer.

## Mirror

Press `M` on the keyboard to flip the camera horizontally.

## Files

- `index.html` — the entire app (HTML + CSS + JS, single file)
- `main_legacy.js` — old standalone Phase 8 logic, kept as reference only
- `*.mp3` — audio assets
