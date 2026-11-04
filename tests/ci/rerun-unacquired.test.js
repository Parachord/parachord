// When GitHub has no Mac runner for a job, it cancels the job after about 15
// minutes without running a step. Those get retried. Anything else that ended
// without passing is somebody's real result, and must be left alone.
const { planRerun, candidateJobs, MAX_ATTEMPTS, NOT_ACQUIRED } = require('../../scripts/rerun-unacquired');

const run = (over = {}) => ({ id: 1, run_attempt: 1, status: 'completed', conclusion: 'failure', ...over });
const unacquired = (id = 10) => ({ id, name: 'build (macos-latest, mac, arm64, Apple-Silicon)', conclusion: 'cancelled', steps: [] });
const annotated = { 10: [`The job was ${NOT_ACQUIRED} of type hosted even after multiple attempts`] };

describe('candidateJobs', () => {
  test('a cancelled job that ran no steps is a candidate', () => {
    expect(candidateJobs([unacquired()]).map(j => j.id)).toEqual([10]);
  });
  test('a job that started, failed or passed is not', () => {
    expect(candidateJobs([
      { id: 1, conclusion: 'cancelled', steps: [{ name: 'Checkout' }] },
      { id: 2, conclusion: 'failure', steps: [] },
      { id: 3, conclusion: 'success', steps: [{ name: 'Checkout' }] }
    ])).toEqual([]);
  });
});

describe('planRerun', () => {
  const plan = (over = {}) => planRerun({ run: run(), jobs: [unacquired()], annotations: annotated, latestRunId: 1, ...over });

  test('reruns when a job never got a runner', () => {
    expect(plan()).toMatchObject({ rerun: true });
  });

  test('a job cancelled by a newer push is not retried: it has no such annotation', () => {
    expect(plan({ annotations: { 10: [] } })).toMatchObject({ rerun: false });
    expect(plan({ annotations: { 10: ['Due to capacity constraints, jobs may experience longer queue times.'] } })).toMatchObject({ rerun: false });
  });

  test('never reruns an old run: its concurrency group would cancel the newer one', () => {
    expect(plan({ latestRunId: 2 })).toMatchObject({ rerun: false });
  });

  test('does not spend a runner on a closed PR', () => {
    expect(plan({ prClosed: true })).toMatchObject({ rerun: false });
  });

  test('gives up after the attempt limit', () => {
    expect(plan({ run: run({ run_attempt: MAX_ATTEMPTS - 1 }) })).toMatchObject({ rerun: true });
    expect(plan({ run: run({ run_attempt: MAX_ATTEMPTS }) })).toMatchObject({ rerun: false });
  });

  test('a run that passed or is still going is left alone', () => {
    expect(plan({ run: run({ conclusion: 'success' }) })).toMatchObject({ rerun: false });
    expect(plan({ run: run({ status: 'in_progress', conclusion: null }) })).toMatchObject({ rerun: false });
  });

  test('waiting on a maintainer to approve a fork run is not a runner problem', () => {
    expect(plan({ run: run({ conclusion: 'action_required' }), jobs: [] })).toMatchObject({ rerun: false });
  });

  test('every decision says why', () => {
    for (const over of [{}, { latestRunId: 2 }, { annotations: {} }, { run: run({ run_attempt: MAX_ATTEMPTS }) }]) {
      expect(typeof plan(over).reason).toBe('string');
    }
  });
});
