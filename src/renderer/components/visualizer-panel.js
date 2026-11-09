// src/renderer/components/visualizer-panel.js — the built-in visualiser panel.
//
// Parachord's visualiser: a Vibresia scene, drawn live from the music
// Parachord is playing. The engine is in lib/vibresia-visualizer.js and the
// scenes in lib/vibresia-scenes.js.
//
// The panel is props-driven: the app owns the state (which scene is on, the
// audio element to tap, whether the visualiser is on at all) and passes it
// down. Nothing here reaches into the app's state.
//
// It is a React.memo'd module so a Parachord re-render — which happens on
// every setState — does not redraw the scene. The draw loop is a
// requestAnimationFrame loop inside the panel, started when the panel mounts
// and stopped when it unmounts, so a closed panel costs nothing.

'use strict';

const { VibresiaRenderer, AudioAnalyser, idleAudio } = require('../lib/vibresia-visualizer');
const { SCENES } = require('../lib/vibresia-scenes');

/** The frame budget: 30fps is plenty for a visualiser and leaves the CPU to the player. */
const FRAME_MS = 1000 / 30;

/** Where the scene list comes from, and what "Auto Scan" means. */
const AUTO_SCAN = { id: 'autoScan', name: 'AUTO SCAN', blurb: 'Cycles through every other scene, on the beat.' };

/**
 * The scene list with Auto Scan at the end, the way Vibresia's app lists
 * them. Auto Scan is a mode rather than a scene, so it is added here rather
 * than in the scene file.
 */
function allScenes() {
  return SCENES.concat([AUTO_SCAN]);
}

/** The next scene in Auto Scan's rotation. */
function nextSceneId(current, ids) {
  const i = ids.indexOf(current);
  return ids[(i + 1) % ids.length];
}

const VisualizerPanel = React.memo(function VisualizerPanel({
  enabled,
  sceneId,
  onSceneChange,
  audioElement,
  trackTitle,
  trackArtist,
  isPlaying,
  onClose
}) {
  const canvasRef = React.useRef(null);
  const rendererRef = React.useRef(null);
  const analyserRef = React.useRef(null);
  const rafRef = React.useRef(null);
  const stateRef = React.useRef({ sceneId, audioElement, isPlaying, trackTitle, trackArtist });
  const [error, setError] = React.useState(null);
  // Whether the renderer exists yet. The scene cannot be compiled until it
  // does, and the renderer is created by the draw loop's effect.
  const [rendererReady, setRendererReady] = React.useState(false);

  // The draw loop reads the latest props through a ref, so a prop change
  // does not tear down and rebuild the WebGL context.
  stateRef.current = { sceneId, audioElement, isPlaying, trackTitle, trackArtist };

  /** The scene to draw, given the current selection. */
  const resolveScene = React.useCallback((id) => {
    if (id === AUTO_SCAN.id) return SCENES[0];
    return SCENES.find((s) => s.id === id) || SCENES[0];
  }, []);

  // The scene changes: compile the new one and redraw.
  //
  // This runs after the draw loop's effect, which is what creates the
  // renderer — on the first mount the renderer does not exist yet, so the
  // scene is compiled once it does.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    const scene = resolveScene(stateRef.current.sceneId);
    if (renderer.sceneId === scene.id) return;
    const result = renderer.setup(scene);
    setError(result.ok ? null : result.error);
    if (result.ok) {
      // The first frame is drawn synchronously, so the panel has an image
      // straight away rather than a black rectangle until the loop starts.
      const a = analyserRef.current
        ? analyserRef.current.read(performance.now() / 1000)
        : null;
      renderer.draw(a || idleAudio(performance.now() / 1000));
    }
  }, [sceneId, enabled, resolveScene, rendererReady]);

  // The audio element to tap changes: point the analyser at the new one.
  React.useEffect(() => {
    if (!enabled) return;
    if (!analyserRef.current) analyserRef.current = new AudioAnalyser();
    analyserRef.current.attach(audioElement);
  }, [audioElement, enabled]);

  // The draw loop.
  React.useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!rendererRef.current) {
      rendererRef.current = new VibresiaRenderer(canvas);
      // The scene is compiled by the effect above, which needs the renderer
      // to exist. This tells it that it does.
      setRendererReady(true);
    }
    const renderer = rendererRef.current;

    // Size the canvas to the element it sits in, so the scene is not
    // stretched. WebGL draws in the canvas's own pixels.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(rect.width));
      const h = Math.max(2, Math.round(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        // The texture the scene is drawn into has to match the canvas.
        const gl = renderer.gl;
        if (gl && renderer.tex) {
          gl.bindTexture(gl.TEXTURE_2D, renderer.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
      }
    };

    let last = 0;
    let elapsed = 6.0;  // start far enough in that time-driven scenes have reached their stride
    let autoScanUntil = 0;
    let autoScanIndex = 0;

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      elapsed += FRAME_MS / 1000;
      resize();

      const state = stateRef.current;

      // Auto Scan moves between scenes on the beat, the way Vibresia's app
      // does: a scene holds for a few bars rather than a fixed timer.
      if (state.sceneId === AUTO_SCAN.id) {
        const analyser = analyserRef.current;
        const heard = analyser ? analyser.read(elapsed) : null;
        const beat = heard && heard.beat;
        if (beat && elapsed > autoScanUntil) {
          autoScanIndex = (autoScanIndex + 1) % SCENES.length;
          const scene = SCENES[autoScanIndex];
          const result = renderer.setup(scene);
          setError(result.ok ? null : result.error);
          autoScanUntil = elapsed + 8.0;
        }
      }

      const analyser = analyserRef.current;
      const heard = analyser ? analyser.read(elapsed) : null;
      const a = heard || idleAudio(elapsed);
      const trackKnown = !!state.isPlaying;
      a.trackKnown = trackKnown;
      a.trackPos = 0;
      a.trackDuration = 0;
      a.trackProgress = 0;
      renderer.draw(a);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [enabled]);

  // On unmount, release the GL resources and the audio tap.
  React.useEffect(() => () => {
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.detach();
      analyserRef.current = null;
    }
  }, []);

  if (!enabled) return null;

  const scenes = allScenes();

  return React.createElement('div', {
    className: 'fixed inset-0 z-50 flex flex-col bg-black',
    style: { background: '#05010a' }
  },
    // The scene itself.
    React.createElement('div', { className: 'flex-1 relative min-h-0' },
      React.createElement('canvas', {
        ref: canvasRef,
        className: 'w-full h-full block',
        'aria-label': 'A Vibresia scene, drawn from the music Parachord is playing'
      }),
      // The track it is drawing, quietly, in the corner.
      React.createElement('div', {
        className: 'absolute bottom-3 left-4 text-xs opacity-60 pointer-events-none select-none',
        style: { color: '#fff' }
      },
        stateRef.current.trackTitle
          ? stateRef.current.trackTitle + (stateRef.current.trackArtist ? ' — ' + stateRef.current.trackArtist : '')
          : 'Nothing playing'
      )
    ),
    // The controls.
    React.createElement('div', {
      className: 'flex items-center gap-3 px-4 py-3 shrink-0',
      style: { background: '#0b0418', borderTop: '1px solid rgba(255,255,255,0.08)' }
    },
      React.createElement('button', {
        type: 'button',
        onClick: onClose,
        title: 'Close the visualiser',
        className: 'px-3 py-1.5 rounded text-sm hover:bg-white/10',
        style: { color: '#fff' }
      }, 'Close'),
      // The scene picker.
      React.createElement('div', {
        className: 'flex-1 flex items-center gap-2 overflow-x-auto'
      },
        scenes.map((scene) => React.createElement('button', {
          key: scene.id,
          type: 'button',
          title: scene.blurb,
          onClick: () => onSceneChange && onSceneChange(scene.id),
          className: 'px-3 py-1.5 rounded text-xs whitespace-nowrap ' +
            (sceneId === scene.id ? 'font-semibold' : 'opacity-70 hover:opacity-100'),
          style: {
            color: '#fff',
            background: sceneId === scene.id ? 'rgba(255,255,255,0.14)' : 'transparent'
          }
        }, scene.name))
      )
    ),
    // If a scene will not compile, say so in words rather than showing
    // a black rectangle.
    error ? React.createElement('div', {
      className: 'px-4 py-2 text-xs',
      style: { background: '#2a0b12', color: '#ffb4c0' }
    }, 'That scene would not compile: ' + error) : null
  );
});

module.exports = { VisualizerPanel, allScenes, AUTO_SCAN, nextSceneId };
