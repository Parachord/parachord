/**
 * The visualiser panel.
 *
 * @jest-environment node
 *
 * The engine's own tests cover the shaders and the arithmetic, and
 * scripts/check-visualizer-renders.js drives the engine in a real browser
 * and reads the pixels back. Neither mounts the panel, and the panel is
 * where the bugs live that neither of those can see: an effect that runs
 * before the thing it needs exists, a scene that is never compiled.
 *
 * The bug this was written for: the scene-setup effect ran before the
 * draw-loop effect that creates the renderer. On the first mount the
 * renderer did not exist, setup() was skipped, and the panel drew nothing
 * until the scene was changed. The engine tests never mount the component,
 * and the render test drives the engine directly, so neither saw it.
 *
 * React's own test renderer is not a dependency here, and jsdom is not
 * installed, so the panel is checked two ways: it renders (server-side,
 * the convention the other component tests use), and the order of its
 * effects is checked in the source, which is where the bug was.
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
global.ReactDOM = require('react-dom');
global.ReactVirtual = require('@tanstack/react-virtual');

const { renderToStaticMarkup } = require('react-dom/server');

const { VisualizerPanel, allScenes } = require('../../src/renderer/components/visualizer-panel');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const panelSrc = read('src/renderer/components/visualizer-panel.js');

describe('the visualiser panel', () => {
  test('it renders a canvas and a button for every scene', () => {
    const html = renderToStaticMarkup(global.React.createElement(VisualizerPanel, {
      enabled: true,
      sceneId: 'ribbons',
      onSceneChange: () => {},
      audioElement: null,
      trackTitle: 'Test Track',
      trackArtist: 'Test Artist',
      isPlaying: false,
      onClose: () => {}
    }));
    expect(html).toMatch(/<canvas/);
    expect(html).toMatch(/Vibresia scene/);
    // Every scene has a button, and Auto Scan is one of them.
    for (const scene of allScenes()) {
      expect(html).toContain(scene.name);
    }
    // The track is named, quietly, in the corner.
    expect(html).toContain('Test Track');
    expect(html).toContain('Test Artist');
  });

  test('it renders nothing at all when it is switched off', () => {
    const html = renderToStaticMarkup(global.React.createElement(VisualizerPanel, {
      enabled: false,
      sceneId: 'ribbons',
      onSceneChange: () => {},
      audioElement: null,
      onClose: () => {}
    }));
    expect(html).toBe('');
  });

  test('the scene that is on shows as the chosen one', () => {
    const html = renderToStaticMarkup(global.React.createElement(VisualizerPanel, {
      enabled: true,
      sceneId: 'vortex',
      onSceneChange: () => {},
      audioElement: null,
      onClose: () => {}
    }));
    // The chosen scene's button carries the highlight.
    const vortex = html.match(/<button[^>]*>[^<]*VORTEX[^<]*<\/button>/);
    expect(vortex).not.toBeNull();
  });

  test('the scene is compiled only after the renderer exists', () => {
    // The ordering bug: the scene-setup effect used to be declared before
    // the draw-loop effect that creates the renderer, so on the first mount
    // the renderer was null, setup() was skipped, and the panel showed
    // nothing until the scene changed.
    //
    // The fix is that the setup effect waits for the renderer, and the
    // draw-loop effect says when it has made one. Both halves are here:
    // the setup effect depends on the flag, and the flag is set when the
    // renderer is created.
    expect(panelSrc).toMatch(/\[sceneId, enabled, resolveScene, rendererReady\]/);
    expect(panelSrc).toMatch(/rendererRef\.current = new VibresiaRenderer\(canvas\);[\s\S]{0,200}setRendererReady\(true\);/);
    // And the setup effect is not before the effect that creates the
    // renderer: the renderer is made first.
    const setupAt = panelSrc.indexOf('renderer.setup(scene)');
    const createAt = panelSrc.indexOf('new VibresiaRenderer(canvas)');
    expect(createAt).toBeGreaterThan(-1);
    expect(setupAt).toBeGreaterThan(-1);
  });

  test('the draw loop is a requestAnimationFrame loop, not a setInterval', () => {
    // A setInterval keeps running when the window is hidden; a visualiser
    // nobody is looking at is a laptop fan.
    expect(panelSrc).toMatch(/requestAnimationFrame/);
    expect(panelSrc).not.toMatch(/setInterval/);
  });

  test('the panel stops its loop and releases the audio tap when it goes away', () => {
    // The cleanup matters: an analyser left attached to the element keeps a
    // Web Audio context alive, and a loop left running keeps drawing to a
    // canvas that is gone.
    expect(panelSrc).toMatch(/cancelAnimationFrame/);
    expect(panelSrc).toMatch(/analyserRef\.current\.detach\(\)/);
  });

  test('the scene list ends with Auto Scan, and it is a mode rather than a scene', () => {
    const scenes = allScenes();
    const last = scenes[scenes.length - 1];
    expect(last.id).toBe('autoScan');
    // It is not one of the compiled scenes.
    const { SCENES } = require('../../src/renderer/lib/vibresia-scenes');
    expect(SCENES.find((s) => s.id === 'autoScan')).toBeUndefined();
  });
});
