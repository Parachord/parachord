// Every run builds Mac on Apple Silicon, pull requests included (PRs skipped it
// from 2026-11-04 to 2026-11-11 while macOS runners were short, #1252 / #1251).
// The Intel build cross-compiles on the same arm64 machine, so only releases and
// manual runs build it. A release needs both, because the release job merges the
// two Mac manifests for the auto-updater.
const fs = require('fs');
const path = require('path');

const yml = fs.readFileSync(path.join(__dirname, '../../.github/workflows/build.yml'), 'utf8');
const expr = yml.match(/include: >-\s*\n\s*\$\{\{ fromJSON\(format\('\[\{0\}\{1\}\{2\}\]',\s*\n\s*(.+?) && '(\{.+?\}),?' \|\| '',\s*\n\s*'(\{.+?\}),?',\s*\n\s*'(.+?)'\)\) \}\}/);

const name = (j) => `build (${j.os}, ${j.platform}, ${j.arch}${j.arch_label ? `, ${j.arch_label}` : ''})`;

describe('the build matrix', () => {
  test('parses', () => {
    expect(expr).not.toBeNull();
  });
  const intel = JSON.parse(expr[2].replace(/,$/, ''));
  const mac = JSON.parse(expr[3].replace(/,$/, ''));
  const always = JSON.parse(`[${expr[4]}]`);

  test('only tags and manual runs build Intel', () => {
    expect(expr[1]).toContain("startsWith(github.ref, 'refs/tags/')");
    expect(expr[1]).toContain("github.event_name == 'workflow_dispatch'");
    expect(name(intel)).toBe('build (macos-latest, mac, x64, Intel)');
  });

  test('every run builds Apple Silicon, pull requests included', () => {
    // unconditional: no event check in front of the entry
    expect(yml).not.toMatch(/github\.event_name != 'pull_request' && '\{"os":"macos-latest"/);
    expect(name(mac)).toBe('build (macos-latest, mac, arm64, Apple-Silicon)');
  });

  test('Linux and Windows always run, with the job names the required checks use', () => {
    expect(always.map(name)).toEqual([
      'build (ubuntu-latest, linux, x64)',
      'build (windows-latest, win, x64)'
    ]);
  });

  test('every entry has what the build steps read', () => {
    for (const j of [intel, mac, ...always]) {
      expect(Object.keys(j).sort()).toEqual(['arch', 'arch_label', 'os', 'platform']);
    }
  });

  test('the release job still requires the builds', () => {
    expect(yml).toMatch(/release:\n\s+needs: build/);
  });
});

describe('the retry workflow', () => {
  const retry = fs.readFileSync(path.join(__dirname, '../../.github/workflows/rerun-unacquired.yml'), 'utf8');

  test('follows the Build workflow by name', () => {
    expect(yml).toMatch(/^name: Build$/m);
    expect(retry).toContain('workflows: [Build]');
    expect(retry).toContain('types: [completed]');
  });

  test('asks only for the permissions it uses', () => {
    expect(retry).toMatch(/permissions:\n\s+actions: write\n\s+checks: read\n\s+contents: read\n\s+pull-requests: read/);
  });

  test('never checks out or runs code from the run it looks at', () => {
    expect(retry).not.toContain('head_sha');
    expect(retry).not.toContain('head_branch }}');
    expect(retry).not.toMatch(/ref:\s/);
  });
});
