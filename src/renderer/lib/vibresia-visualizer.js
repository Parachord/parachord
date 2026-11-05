// src/renderer/lib/vibresia-visualizer.js — the Vibresia scene renderer.
//
// Parachord's built-in visualiser. It draws a Vibresia scene — the same
// `vec3 render(vec2 p, float t)` contract Vibresia itself uses — from the
// audio Parachord is already playing, and shows it in a panel.
//
// Why the renderer, and not a second app: Vibresia listens to the Mac's system
// audio, which means a second app, a system-audio permission prompt, and a
// scene reacting to whatever else is on the Mac rather than to this player's
// music. Here the analyser taps the shared <audio> element (or the embedded
// player's element) through an AudioContext, so the scene draws the track
// Parachord resolved and is playing. One window, one permission, no routing.
//
// The shaders are the app's own, byte for byte: the same prelude, the same
// `render(vec2, float)` wrapper and the same palette grade, copied from
// Vibresia's share page (site/share/preview.js), which is checked against the
// app's Swift source by Vibresia's own check-preview-glsl.py. A scene written
// for Vibresia therefore draws here unchanged, rather than needing a
// Parachord-specific variant.
//
// GLSL note: the app draws with desktop GLSL 3.30. A browser's (and
// Electron's) WebGL2 context will not accept that — `#version 330 core` fails
// against ANGLE/Metal with "'core' : invalid version directive". WebGL2
// speaks GLSL ES 3.00, which has no default float precision in a fragment
// shader. So the version directive is rewritten and the precision declared.

'use strict';

// The app's prelude: the helpers (hash21, vnoise, fbm, sdCircle, sdBox, ...)
// and the uniforms every scene may read. Copied from Vibresia's share page,
// which keeps it in step with the app's Swift source.
const PRELUDE = `#version 330 core
in vec2 vUV;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform float uBeatStrength;
uniform float uLevel;
uniform vec2 uResolution;
uniform float uIdle;
uniform float uBands[96];
uniform float uActive;      // 0 in silence, eases to 1 with sound
uniform float uBeats;       // beat counter at the detected tempo; continuous, never steps or runs back
uniform float uScroll;      // forward-only distance, faster when louder
uniform float uClock;       // wall-clock seconds; keeps running in silence (use sparingly)
uniform float uLevelSmooth; // slow loudness, 0..1: rises over ~0.3 s, falls over ~1.5 s
uniform float uBassSmooth;  // the same slow easing applied to uBass
uniform float uPresence;    // music presence, 0..1: eases in and out over ~2.3 s, no chatter
uniform int uGenre;         // the genre of the music: 0 classical, 1 electronic, 2 rock,
                             // 3 pop, 4 hiphop, 5 jazz, 6 blues, 7 country, 8 rnb, 9 ambient
uniform float uTrackPos;    // seconds into the track, 0 when there is no position to know
uniform float uTrackDuration; // the length of the track in seconds, 0 when unknown
uniform float uTrackProgress; // 0..1 through the track, 0 when unknown
uniform float uTrackKnown;  // 1 when the position is real, 0 when there is none to know
uniform vec2 uMouse;         // the pointer, in the same coordinates as p: x across, y up from the middle
uniform float uMouseDown;    // 1 while a mouse button is held
uniform float uMouseHere;    // 1 when there is a pointer to react to, 0 when there is not
uniform float uKey;          // the last key pressed, as its character code; 0 when nothing has been pressed
uniform float uKeyDown;      // 1 while a key is held
uniform float uMidiNote;     // the last MIDI note, 0..127
uniform float uMidiVelocity; // how hard it was hit, 0..1
uniform float uMidiNotes;    // how many MIDI notes are held right now
uniform float uMidiCC;       // the last MIDI controller that moved, 0..127
uniform float uMidiCCValue;  // where that controller is, 0..1
out vec4 fragColor;

const float PI = 3.14159265;

// Centered coords: y spans -0.5..0.5, x scales with aspect ratio.
vec2 screenP() { return (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y; }

// Where the pointer is, in the same coordinates as p: x across the
// screen, y up from the middle. It is eased on its way here, so it
// never teleports from one place to another.
vec2 pointerAt() { return uMouse; }

// Where the pointer is, in 0..1 screen coordinates, y up. For the
// vibescapes that draw in that space rather than in p.
vec2 pointerUV() {
    return vec2(0.5 + uMouse.x * uResolution.y / uResolution.x, 0.5 + uMouse.y);
}

// Anti-alias width for a shape drawn at scale \`s\`.
float aaw(float s) { return 1.5 / (uResolution.y * s); }

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Smooth noise, and four octaves of it. This is what anything that looks
// like a cloud, a flame or smoke is built from — and it wasn't here, so
// everyone was writing their own, or reaching for sin() and wondering why
// the result looked like a gradient.
//
// The trap: scale matters more than anything else. Sampled at about the
// screen's scale these are too smooth to see — across a shape a few tenths
// wide you'd be looking at a single slow ramp. Multiply by something like
// 7.0 so several cells land inside the shape.
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);              // smooth, so no grid
    return mix(mix(hash21(i),                hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
               f.y);
}

// Roughly 0..1, averaging a shade under half. Layering two of these and
// pushing the result is usually what turns noise into something with
// structure rather than grain.
//
// The rotation matrix is written out rather than using rot(), which is
// declared further down: GLSL has no forward declarations, and this block
// sits above it.
float fbm(vec2 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) {
        sum += amp * vnoise(p);
        // Rotate as well as scale, so the octaves don't stack into a grid.
        p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + vec2(1.7, 9.2);
        amp *= 0.5;
    }
    return sum;
}
float bandAt(float x) { return uBands[int(clamp(x, 0.0, 0.999) * 96.0)]; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdEllipse(vec2 p, vec2 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdRoundBox(vec2 p, vec2 b, float r) { return sdBox(p, b - r) - r; }
float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}
float fill(float d, float w) { return 1.0 - smoothstep(-w, w, d); }

// Dance timing: one move per beat at the detected tempo (up on one beat,
// down on the next), mostly in unison. Size follows the music; at rest
// (silence) groove() is 0 so dancers settle into their rest pose.
float dance(float phase) { return 0.5 + 0.5 * sin(uBeats * PI + phase * 0.35); }
float groove() { return (0.25 + uBass * 0.9 + uBeatStrength * 0.6) * uActive; }
`;

const WRAPPER = `uniform vec3 uPalette[3];

void main() {
    vec2 p = screenP();
    vec3 c = render(p, uTime);
    fragColor = vec4(clamp(c, vec3(0.0), vec3(1.0)), 1.0);
}`;

const LIQUID_VS = `#version 330 core
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
    vUV = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const GRADE_FS = `#version 330 core
in vec2 vUV;
uniform sampler2D uTex;
uniform vec3 uShadow;
uniform vec3 uHighlight;
uniform float uSaturation;
uniform float uDuotone;
uniform float uLift;
out vec4 fragColor;

void main() {
    vec3 c = texture(uTex, vUV).rgb;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));

    // Duotone: stretch the luminance ramp between the two palette colours.
    vec3 graded = uShadow + (uHighlight - uShadow) * luma;
    c = mix(c, graded, uDuotone);

    // Saturation, around the graded luminance.
    luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, uSaturation);

    // Lift the blacks toward the shadow colour so the image doesn't crush.
    c += uShadow * uLift * (1.0 - luma);

    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// NEON, the first palette in Vibresia's list and the one it opens on.
const PALETTE = {
  shadow:     [0.07, 0.00, 0.11],
  highlight:  [1.00, 0.36, 0.95],
  saturation: 1.15,
  duotone:    0.25,
  lift:       0.22
};

/** Retargets a shader from the app's GLSL to the browser's. */
function toES(source, fragment) {
  const lines = source.replace(/^#version[ \t]+330[ \t]+core/, '#version 300 es').split('\n');
  if (fragment) lines.splice(1, 0, 'precision highp float;', 'precision highp int;');
  return lines.join('\n');
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || 'compile failed');
  }
  return shader;
}

function link(gl, vsSource, fsSource) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  let fs;
  try {
    fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  } catch (e) {
    gl.deleteShader(vs);
    throw e;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || 'link failed');
  }
  return program;
}

function uniforms(gl, program, names) {
  const map = {};
  for (let i = 0; i < names.length; i++) {
    map[names[i]] = gl.getUniformLocation(program, names[i]);
  }
  return map;
}

const SCENE_UNIFORM_NAMES = [
  'uTime', 'uBass', 'uMid', 'uTreble', 'uLevel', 'uLevelSmooth', 'uBassSmooth',
  'uBeat', 'uBeatStrength', 'uResolution', 'uIdle', 'uActive', 'uBeats',
  'uScroll', 'uClock', 'uPresence', 'uGenre', 'uTrackPos', 'uTrackDuration',
  'uTrackProgress', 'uTrackKnown', 'uMouse', 'uMouseDown', 'uMouseHere',
  'uKey', 'uKeyDown', 'uMidiNote', 'uMidiVelocity', 'uMidiNotes', 'uMidiCC',
  'uMidiCCValue', 'uBands[0]', 'uPalette[0]'
];

const GRADE_UNIFORM_NAMES = ['uTex', 'uShadow', 'uHighlight', 'uSaturation', 'uDuotone', 'uLift'];

/**
 * The audio state a frame is drawn with.
 *
 * The shapes here are the app's: a scene reads uBass, uLevelSmooth and the
 * 96 bands, and expects them to be in the ranges the app produces. The
 * analyser below produces exactly those, from the same formulas, so a scene
 * behaves in Parachord the way it does in Vibresia.
 */
function idleAudio(time) {
  return {
    time,
    beats: time * (124 / 60),
    scroll: time * 0.7,
    clock: time,
    bass: 0,
    mid: 0,
    treble: 0,
    level: 0,
    levelSmooth: 0,
    bassSmooth: 0,
    beat: 0,
    beatStrength: 0,
    idle: 1,
    active: 0,
    presence: 0,
    bands: new Array(96).fill(0)
  };
}

/**
 * Reads the audio an <audio> element is playing and turns it into the
 * uniforms a scene draws with.
 *
 * The tap is a MediaElementAudioSourceNode on the element itself. That
 * reroutes the element's output through the graph, so the analyser has to be
 * connected onward to the destination or the sound stops. Done here, once,
 * when the context is created.
 */
class AudioAnalyser {
  constructor() {
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.element = null;
    this.bins = null;
    this.hz = 0;
    this.state = {
      level: 0,
      bass: 0,
      avg: 0.2,
      kick: 0,
      lastBeat: 0
    };
    this.bands = new Array(96).fill(0);
  }

  /**
   * Points the analyser at an element. Returns false when the element
   * cannot be tapped (no Web Audio, or the element is already tapped by
   * another source — a MediaElementAudioSourceNode can only be made once
   * per element).
   */
  attach(element) {
    if (!element) return false;
    if (this.element === element && this.analyser) return true;
    if (this.element) this.detach();
    const AudioContextCtor = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    if (!AudioContextCtor) return false;
    try {
      this.context = new AudioContextCtor();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.0;
      this.source = this.context.createMediaElementSource(element);
      this.source.connect(this.analyser);
      // The element's sound has to reach the speakers. Routing it through
      // the analyser and on to the destination is what keeps the audio
      // playing: the source node took over the element's output.
      this.analyser.connect(this.context.destination);
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      this.hz = this.context.sampleRate / this.analyser.fftSize;
      this.element = element;
      return true;
    } catch (e) {
      // An element that is already routed to another context cannot be
      // tapped again. That is not fatal: the scene falls back to the
      // synthetic beat rather than taking the sound away.
      this.context = null;
      this.analyser = null;
      this.source = null;
      this.bins = null;
      this.element = null;
      return false;
    }
  }

  detach() {
    try {
      if (this.source) this.source.disconnect();
      if (this.analyser) this.analyser.disconnect();
      if (this.context && this.context.state !== 'closed') this.context.close();
    } catch (e) {
      // A context that is already closed throws; there is nothing to do.
    }
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.bins = null;
    this.element = null;
  }

  /** The energy in a frequency band, 0..1. */
  band(lo, hi) {
    const bins = this.bins;
    if (!bins || !this.hz) return 0;
    let a = Math.floor(lo / this.hz);
    let b = Math.max(a + 1, Math.floor(hi / this.hz));
    if (b > bins.length) b = bins.length;
    if (a >= bins.length) return 0;
    let sum = 0;
    for (let i = a; i < b; i++) sum += bins[i];
    return sum / (b - a) / 255;
  }

  /**
   * The uniforms for this frame, from the music that is playing.
   *
   * The smoothing is the app's: a fast loudness and a slow one, so a scene
   * can ask for either. The beat is a bass spike over its own running
   * average, which is how the app finds a kick without a tempo tracker.
   */
  read(time) {
    if (!this.analyser || !this.element || this.element.paused) {
      return null;
    }
    this.analyser.getByteFrequencyData(this.bins);
    const bass = this.band(30, 150);
    const mid = this.band(300, 2000);
    const treble = this.band(4000, 12000);
    const level = (bass + mid + treble) / 3;

    const s = this.state;
    s.level += (level - s.level) * 0.08;
    s.bass += (bass - s.bass) * 0.1;
    s.avg += (bass - s.avg) * 0.02;
    const kick = bass > s.avg * 1.3 && bass > 0.25 ? 1 : s.kick * 0.85;

    const bands = [];
    for (let i = 0; i < 96; i++) {
      const lo = 40 * Math.pow(400, i / 96);
      const hi = 40 * Math.pow(400, (i + 1) / 96);
      bands.push(this.band(lo, hi));
    }
    this.bands = bands;

    const beatNow = kick > 0.75 ? 1 : 0;
    const beatStrength = 0.62 * kick;
    // The beat counter the app keeps: continuous, climbing with the music,
    // never stepping back. Scenes read uBeats to move on the beat.
    if (beatNow && !s.lastBeat) {
      s.lastBeat = time;
    }
    const beats = s.lastBeat ? (time - s.lastBeat) * (124 / 60) : time * (124 / 60);

    return {
      time,
      beats,
      scroll: time * 0.7,
      clock: time,
      bass,
      mid,
      treble,
      level,
      levelSmooth: s.level,
      bassSmooth: s.bass,
      beat: beatNow,
      beatStrength,
      idle: 0,
      active: 1,
      presence: Math.min(1, s.level * 2),
      bands
    };
  }
}

/**
 * The scene renderer: a WebGL2 canvas, one compiled program per scene.
 *
 * The scene is drawn into a texture because the palette grade has to sample
 * it — the same two-pass shape Vibresia uses, so the colours here are the
 * colours there.
 */
class VibresiaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.state = null;
    this.program = null;
    this.grade = null;
    this.u = null;
    this.g = null;
    this.fbo = null;
    this.tex = null;
    this.vao = null;
    this.sceneId = null;
    this.error = null;
    this.width = 0;
    this.height = 0;
  }

  /** The WebGL2 context, or null when the machine cannot give one. */
  context() {
    if (this.gl) return this.gl;
    if (!this.canvas) return null;
    try {
      this.gl = this.canvas.getContext('webgl2', {
        antialias: false,
        preserveDrawingBuffer: true,
        alpha: false
      });
    } catch (e) {
      this.gl = null;
    }
    return this.gl;
  }

  /**
   * Compiles a scene. Returns {ok} or {ok:false, error} with the driver's
   * own words, so a broken scene says what is wrong rather than showing a
   * black rectangle.
   *
   * A scene comes in two shapes, and both are Vibresia's own:
   *   - `body`: a full fragment shader that writes fragColor in its main()
   *     (the built-in scenes). Compiled as prelude + body.
   *   - `render`: a `vec3 render(vec2 p, float t)` function (what a
   *     vibescape author writes). Compiled as prelude + render + wrapper.
   */
  setup(scene) {
    const gl = this.context();
    if (!gl) return { ok: false, error: 'no webgl2' };

    const vs = toES(LIQUID_VS, false);
    const fragment = scene.render
      ? toES(PRELUDE + '\n' + scene.render + '\n' + WRAPPER, true)
      : toES(PRELUDE + '\n' + scene.body + '\n', true);
    let program;
    let grade;
    try {
      // The order matters: GLSL has no forward declarations, so the caller of
      // `render` has to come after the function it calls.
      program = link(gl, vs, fragment);
      grade = link(gl, vs, toES(GRADE_FS, true));
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // The scene is drawn into a texture because the grade has to sample it.
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.canvas.width, this.canvas.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      return { ok: false, error: 'framebuffer incomplete' };
    }

    this.program = program;
    this.grade = grade;
    this.vao = vao;
    this.fbo = fbo;
    this.tex = tex;
    this.u = uniforms(gl, program, SCENE_UNIFORM_NAMES);
    this.g = uniforms(gl, grade, GRADE_UNIFORM_NAMES);
    this.sceneId = scene.id;
    this.error = null;
    return { ok: true };
  }

  /** Draws one frame with the given audio state. */
  draw(a) {
    const gl = this.gl;
    if (!gl || !this.program) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const u = this.u;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.02, 0.004, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1f(u.uTime, a.time);
    gl.uniform1f(u.uBass, a.bass);
    gl.uniform1f(u.uMid, a.mid);
    gl.uniform1f(u.uTreble, a.treble);
    gl.uniform1f(u.uLevel, a.level);
    gl.uniform1f(u.uLevelSmooth, a.levelSmooth);
    gl.uniform1f(u.uBassSmooth, a.bassSmooth);
    gl.uniform1f(u.uBeat, a.beat);
    gl.uniform1f(u.uBeatStrength, a.beatStrength);
    gl.uniform2f(u.uResolution, w, h);
    gl.uniform1f(u.uIdle, a.idle);
    gl.uniform1f(u.uActive, a.active);
    gl.uniform1f(u.uBeats, a.beats);
    gl.uniform1f(u.uScroll, a.scroll);
    gl.uniform1f(u.uClock, a.clock);
    gl.uniform1f(u.uPresence, a.presence);
    gl.uniform1f(u.uTrackPos, a.trackPos || 0);
    gl.uniform1f(u.uTrackDuration, a.trackDuration || 0);
    gl.uniform1f(u.uTrackProgress, a.trackProgress || 0);
    gl.uniform1f(u.uTrackKnown, a.trackKnown ? 1 : 0);
    gl.uniform1i(u.uGenre, a.genre == null ? 2 : a.genre);
    gl.uniform2f(u.uMouse, a.mouseX || 0, a.mouseY || 0);
    gl.uniform1f(u.uMouseDown, a.mouseDown ? 1 : 0);
    gl.uniform1f(u.uMouseHere, a.mouseHere ? 1 : 0);
    gl.uniform1f(u.uKey, 0);
    gl.uniform1f(u.uKeyDown, 0);
    gl.uniform1f(u.uMidiNote, 0);
    gl.uniform1f(u.uMidiVelocity, 0);
    gl.uniform1f(u.uMidiNotes, 0);
    gl.uniform1f(u.uMidiCC, 0);
    gl.uniform1f(u.uMidiCCValue, 0);
    gl.uniform1fv(u['uBands[0]'], a.bands);
    gl.uniform3fv(u['uPalette[0]'], [
      PALETTE.shadow[0], PALETTE.shadow[1], PALETTE.shadow[2],
      PALETTE.highlight[0], PALETTE.highlight[1], PALETTE.highlight[2],
      (PALETTE.shadow[0] + PALETTE.highlight[0]) / 2,
      (PALETTE.shadow[1] + PALETTE.highlight[1]) / 2,
      (PALETTE.shadow[2] + PALETTE.highlight[2]) / 2
    ]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // The palette grade, so this looks like Vibresia rather than raw shader
    // output.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.grade);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.g.uTex, 0);
    gl.uniform3fv(this.g.uShadow, PALETTE.shadow);
    gl.uniform3fv(this.g.uHighlight, PALETTE.highlight);
    gl.uniform1f(this.g.uSaturation, PALETTE.saturation);
    gl.uniform1f(this.g.uDuotone, PALETTE.duotone);
    gl.uniform1f(this.g.uLift, PALETTE.lift);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /** Releases the GL resources. */
  dispose() {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.grade) gl.deleteProgram(this.grade);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      if (this.tex) gl.deleteTexture(this.tex);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.program = null;
    this.grade = null;
    this.fbo = null;
    this.tex = null;
    this.vao = null;
    this.sceneId = null;
  }
}

module.exports = {
  VibresiaRenderer,
  AudioAnalyser,
  idleAudio,
  PALETTE,
  PRELUDE,
  WRAPPER,
  toES
};
