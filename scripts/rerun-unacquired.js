#!/usr/bin/env node
// Reruns a Build run when GitHub had no runner for one of its jobs.
//
// During a Mac runner shortage a job waits about 15 minutes and is cancelled
// without running a step: "The job was not acquired by Runner of type hosted even
// after multiple attempts". That says nothing about the code, so it gets retried
// up to MAX_ATTEMPTS. A job that started, a real failure, or a job cancelled by a
// newer push gets no such message, and is left alone.
//
// Run by .github/workflows/rerun-unacquired.yml. To try it against a real run
// without changing anything:
//   GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=owner/repo RUN_ID=123 DRY_RUN=1 node scripts/rerun-unacquired.js

'use strict';

const MAX_ATTEMPTS = 4;
const NOT_ACQUIRED = 'not acquired by Runner';

// A runner never picked it up: cancelled, with no steps.
const candidateJobs = (jobs) => (jobs || []).filter(
  (job) => job.conclusion === 'cancelled' && (job.steps || []).length === 0
);

function planRerun({ run, jobs, annotations, latestRunId, prClosed = false }) {
  if (run.status !== 'completed') return { rerun: false, reason: `still ${run.status}` };
  if (run.conclusion === 'success') return { rerun: false, reason: 'it passed' };
  const unacquired = candidateJobs(jobs).filter((job) => (annotations[job.id] || []).some((m) => m.includes(NOT_ACQUIRED)));
  if (unacquired.length === 0) return { rerun: false, reason: 'no job was left without a runner' };
  // A rerun joins the run's concurrency group, so an old run would cancel a newer one.
  if (latestRunId !== run.id) return { rerun: false, reason: `run ${latestRunId} is newer` };
  // Runners are the scarce thing here: don't spend one on a PR nobody is waiting on.
  if (prClosed) return { rerun: false, reason: 'its PR is closed' };
  if (run.run_attempt >= MAX_ATTEMPTS) return { rerun: false, reason: `already tried ${run.run_attempt} times` };
  return {
    rerun: true,
    reason: `no runner for: ${unacquired.map((job) => job.name).join(', ')} (attempt ${run.run_attempt} of ${MAX_ATTEMPTS})`
  };
}

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_ID, DRY_RUN } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !/^\d+$/.test(RUN_ID || '')) {
    throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and a numeric RUN_ID are required');
  }
  const api = async (route, options = {}) => {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/${route}`, {
      ...options,
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    return response.status === 201 || response.status === 204 ? null : response.json();
  };

  const run = await api(`actions/runs/${RUN_ID}`);
  const { jobs } = await api(`actions/runs/${RUN_ID}/jobs?filter=latest&per_page=100`);
  const annotations = {};
  for (const job of candidateJobs(jobs)) {
    const found = await api(`check-runs/${job.id}/annotations`);
    annotations[job.id] = found.map((a) => a.message || '');
  }
  const query = new URLSearchParams({ branch: run.head_branch || '', event: run.event, per_page: '1' });
  const latest = await api(`actions/workflows/${run.workflow_id}/runs?${query}`);
  const latestRunId = latest.workflow_runs[0] ? latest.workflow_runs[0].id : run.id;

  // Looked up by branch: a run's own pull_requests list is empty once the PR
  // closes, and always for a fork.
  let prClosed = false;
  if (run.event === 'pull_request') {
    const head = `${run.head_repository.owner.login}:${run.head_branch}`;
    const open = await api(`pulls?${new URLSearchParams({ state: 'open', head, per_page: '1' })}`);
    prClosed = open.length === 0;
  }

  const plan = planRerun({ run, jobs, annotations, latestRunId, prClosed });
  console.log(`Run ${run.id}: ${plan.rerun ? 'rerunning' : 'leaving it'}, ${plan.reason}`);
  if (plan.rerun && !DRY_RUN) await api(`actions/runs/${run.id}/rerun-failed-jobs`, { method: 'POST' });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { planRerun, candidateJobs, MAX_ATTEMPTS, NOT_ACQUIRED };
