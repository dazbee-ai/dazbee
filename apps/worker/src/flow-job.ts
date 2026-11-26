// Runs the flow's jobs from the one `ai-flow` queue (ADR-0022): each attempt runs its job kind's script over
// `callAi`, up to 4 calls at once per job and at most the worker-wide limit across jobs, the pictures it makes
// stored as the workspace's originals and recorded as assets of the job's brand.
import { FLOW_CALLS_AT_ONCE, runFlowJob } from '@dazbee/ai'

import {
  type JobAttempt,
  type JobWorker,
  type JobWorkerDeps,
  type Limiter,
  limiter,
  startJobWorker,
} from './job-worker.ts'
import { workspaceFiles } from './steps-job.ts'

/** What a flow worker runs on. */
export interface FlowWorkerDeps extends JobWorkerDeps {
  /** The sellers to try for every call in place of each model's own: tests only. */
  sellers?: string[]
}

/** Starts running the queue's flow jobs, switching on each job's kind. */
export async function startFlowWorker(deps: FlowWorkerDeps): Promise<JobWorker> {
  return startJobWorker(deps, (attempt, calls) => runFlow(deps, attempt, calls))
}

/** Runs a flow job's attempt with its job kind's script. */
async function runFlow(deps: FlowWorkerDeps, attempt: JobAttempt, calls: Limiter) {
  const { input: flow } = attempt
  if (flow.kind === 'ai-steps') throw new Error('the ai-flow queue can’t run an ai-steps job')
  // The job's own limit is taken first, so a job waiting for the worker's holds no more than its share.
  const own = limiter(FLOW_CALLS_AT_ONCE)
  return runFlowJob(
    {
      db: deps.db,
      files: workspaceFiles(deps.storage, attempt.workspace),
      limit: (task) => own.run(() => calls.run(task)),
      ...(deps.sellers ? { sellers: deps.sellers } : {}),
    },
    { job: attempt.job, workspace: attempt.workspace, attempt: attempt.attempt, flow, signal: attempt.signal },
  )
}
