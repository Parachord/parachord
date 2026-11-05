# The built-in visualiser (Vibresia)

Parachord draws a **Vibresia scene** — the same kind of scene the Vibresia
app draws — from the music Parachord is playing. It is a panel over the app,
opened from the **Visualizer** button at the bottom of the sidebar.

| Piece | File |
|---|---|
| The engine: WebGL2 renderer, audio analyser, the shaders | `src/renderer/lib/vibresia-visualizer.js` |
| The scenes (Vibresia's own, copied) | `src/renderer/lib/vibresia-scenes.js` (generated) |
| The panel (props-driven, React.memo'd) | `src/renderer/components/visualizer-panel.js` |
| The refresh of the copied scenes | `scripts/extract-vibresia-scenes.py` |
| The check that the copy has not drifted | `scripts/check-vibresia-shaders.js` |
| The check that every scene compiles | `scripts/check-vibresia-scenes.js` |

## Why it is in the app and not a second app

Vibresia listens to the Mac's **system audio**. On its own that is the right
design for a visualiser: one app covers every music app. But it also means a
second app, a macOS system-audio permission prompt, and a scene reacting to
whatever else is on the Mac rather than to *this* player's music.

Inside Parachord the audio comes from the element the current source is
already playing through — `mediaElementFor(currentTrack?._activeResolver)` —
so the scene follows the track Parachord resolved. One window, one
permission, no routing, and the picture is of *this* music.

That element is not always the shared `<audio>`: an embedded player (the
SoundCloud widget) has its own HTMLMediaElement-shaped facade, and
`mediaElementFor` returns that one instead. Whichever it is, the analyser
taps it.

## The audio

`AudioAnalyser` makes a `MediaElementAudioSourceNode` on the element and
routes it through an `AnalyserNode` to the destination.

**The analyser must be connected onward to the destination, or the sound
stops.** Creating a `MediaElementAudioSourceNode` takes over the element's
output; the graph has to carry it to the speakers or the music goes quiet.
This is the single easiest way to break playback with a visualiser, so the
connection is made once, where the context is created.

A `MediaElementAudioSourceNode` can be made **once per element**. An element
that is already tapped by another source cannot be tapped again; the attempt
throws, the analyser reports that it could not attach, and the scene falls
back to the synthetic beat rather than taking the sound away. Silently
losing the picture is better than silently losing the music.

The levels are the app's, so a scene written for Vibresia behaves the same
here: a fast loudness (`uLevel`) and a slow one (`uLevelSmooth`), a bass that
eases (`uBassSmooth`), 96 bands across the spectrum, and a beat found by a
bass spike over its own running average rather than a tempo tracker.

## The shaders

Parachord uses **Vibresia's shaders, byte for byte**: the same prelude, the
same scene bodies, the same vertex shader, the same palette grade. Not a
lookalike — the same text. A scene that looks right in Vibresia looks right
here.

`scripts/check-vibresia-shaders.js` compares the two sides and fails on any
difference. It runs in CI, and skips itself when the Vibresia checkout is
not present.

The scene bodies are copied rather than fetched, because Parachord has its
own release cycle and a visualiser that needs the network to draw would be a
poor neighbour. `scripts/extract-vibresia-scenes.py` regenerates the copy
from Vibresia's Swift source, so it is refreshed rather than hand-edited.

**GLSL ES, not desktop GLSL.** The app draws with `#version 330 core`. A
WebGL2 context will not accept that — against ANGLE/Metal it fails with
`'core' : invalid version directive` for both stages — and WebGL2 speaks GLSL
ES 3.00, which has no default float precision in a fragment shader. So the
version directive is rewritten and the precision declared (`toES`). Without
that, no scene would draw at all.

**Two shapes of scene.** A built-in scene is a full fragment shader that
writes `fragColor` in its `main()`, compiled as prelude + body. A vibescape
an author writes is a `vec3 render(vec2 p, float t)` function, compiled as
prelude + body + the wrapper that calls it. The renderer takes either.

## The panel

`VisualizerPanel` is props-driven and `React.memo`'d: the app owns the state
(which scene is on, the element to tap) and passes it down. The panel owns
the draw loop, which is a `requestAnimationFrame` loop at 30fps — a
visualiser does not need the frame rate, and the CPU belongs to the player.

The loop reads the latest props through a ref, so a prop change does not
tear down and rebuild the WebGL context.

**The first frame is drawn synchronously**, so the panel has an image
straight away rather than a black rectangle until the loop starts.

**A scene that will not compile says so in words**, in a strip under the
picture, rather than showing a black rectangle. The error is the driver's
own message.

**Auto Scan** cycles through the scenes on the beat, the way Vibresia's app
does: a scene holds for a few bars rather than a fixed timer.

## The scene is remembered

The chosen scene is stored under `visualizer_scene` (a store key, so it is
allowlisted in `main-process/ipc/store.js` like every other one). The read
waits for `cacheLoaded`, so the write effect cannot fire on mount with the
default and overwrite the choice the user actually made. A saved scene that
no longer exists — a scene was dropped — falls back to the default rather
than leaving the panel with nothing to draw.

## Testing

- `tests/renderer/vibresia-visualizer.test.js` — the scene list, the
  uniforms and helpers the prelude carries, the GLSL retargeting, the
  analyser's arithmetic, and the wiring in `app.js`.
- `scripts/check-vibresia-scenes.js` — compiles **every** scene with a real
  GLSL compiler (the Vibresia app) and fails on one that will not compile.
  Run it locally: `npm run vibresia:check-scenes`. It needs the Vibresia app
  built, and skips itself when it is not there.

## Copy protection

The visualiser reads the audio that is playing, in the app's own renderer. It
does not decrypt, record, download or save protected streams, and it does
not touch the service's licence. Parachord's existing rules are unchanged:
Spotify plays in Spotify's own app through Spotify Connect, Apple Music on
macOS plays through Apple's MusicKit, and Amazon Music is decrypted inside
the Widevine module. A scene sees samples that are already playing; it never
sees a key.
