// The tag's release publishes with its RELEASE_NOTES.md section as the body
// (#1542), not GitHub's generated list of PRs: the app's What's New reads the
// GitHub release body first (parseHighlights in main.js).

const fs = require('fs');
const path = require('path');
const { releaseNotesSection } = require('../../scripts/release-notes-section');

const NOTES = `# Parachord (unreleased)

**Release date:** not yet released

## Services

- Something new.

---

# Parachord v0.9.13

**Release date:** 2026-11-18

> A summary.

---

## Home

- **First.** One.
- Second.

---

# Parachord v0.9.12

**Release date:** 2026-11-03

## Older

- Old.
`;

describe('releaseNotesSection', () => {
  test('takes the version\'s section, without its heading or the trailing ---', () => {
    const out = releaseNotesSection(NOTES, 'v0.9.13');
    expect(out).toBe('**Release date:** 2026-11-18\n\n> A summary.\n\n---\n\n## Home\n\n- **First.** One.\n- Second.\n');
    expect(out).not.toContain('# Parachord');
    expect(out).not.toContain('Old.');
  });

  test('vX.Y.Z and X.Y.Z both work; the last section runs to the end', () => {
    expect(releaseNotesSection(NOTES, '0.9.13')).toBe(releaseNotesSection(NOTES, 'v0.9.13'));
    expect(releaseNotesSection(NOTES, 'v0.9.12')).toBe('**Release date:** 2026-11-03\n\n## Older\n\n- Old.\n');
  });

  test('a version with no section is null; the unreleased heading is never a version', () => {
    expect(releaseNotesSection(NOTES, 'v9.9.9')).toBeNull();
    expect(releaseNotesSection(NOTES, '')).toBeNull();
    expect(releaseNotesSection(NOTES, 'v0.9.1')).toBeNull(); // not a prefix match of 0.9.12/0.9.13
  });

  test('the real RELEASE_NOTES.md has a section for the version in package.json once it is released', () => {
    const notes = fs.readFileSync(path.join(__dirname, '../../RELEASE_NOTES.md'), 'utf8');
    const { version } = require('../../package.json');
    // package.json carries the last released version; its section exists.
    expect(releaseNotesSection(notes, `v${version}`)).toEqual(expect.stringContaining('**Release date:**'));
  });
});

describe('the release job', () => {
  const yml = fs.readFileSync(path.join(__dirname, '../../.github/workflows/build.yml'), 'utf8');
  const job = yml.slice(yml.indexOf('\n  release:\n'));

  test('checks out the notes and the script into their own folder, after nothing it would delete', () => {
    expect(job).toMatch(/uses: actions\/checkout@v6\n\s+with:\n\s+path: release-notes\n\s+sparse-checkout: \|\n\s+RELEASE_NOTES\.md\n\s+scripts\/release-notes-section\.js/);
  });

  test('writes the body from the tag\'s section, and warns when there is none', () => {
    expect(job).toContain('if node release-notes/scripts/release-notes-section.js "$GITHUB_REF_NAME" > release-body.md; then');
    expect(job).toContain('echo "found=true" >> "$GITHUB_OUTPUT"');
    expect(job).toContain('echo "found=false" >> "$GITHUB_OUTPUT"');
    expect(job).toContain('::warning title=Release notes missing::');
  });

  test('publishes with the section as its body; generated notes only when there is no section', () => {
    const create = job.slice(job.indexOf('- name: Create Release'));
    expect(create).toContain('uses: softprops/action-gh-release@v2');
    expect(create).toContain('body_path: release-body.md');
    expect(create).toContain("generate_release_notes: ${{ steps.notes.outputs.found != 'true' }}");
    expect(create).not.toMatch(/generate_release_notes: true/);
    // The body is written before the release is created.
    expect(job.indexOf('- name: Write the release body')).toBeLessThan(job.indexOf('- name: Create Release'));
  });
});
