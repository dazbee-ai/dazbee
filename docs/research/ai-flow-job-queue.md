# AI flow: the job queue

This is input for the AI template flow spec. It compares ways to run the flow's long jobs (drafts, layer plans, layering) outside a web request. Sources were read on 25 Nov 2026.

## What the queue must do

- **Take long jobs off the request.** Layering takes 35–95 s, so the API saves a job and answers at once. The person can leave and come back.
- **Smooth bursts.** Jobs wait their turn instead of going over a seller's per-minute limit or overloading the GPU. OpenAI's lowest tier allows 20 pictures a minute.
- **Survive a crash.** A job whose worker dies is run again, not lost. An allowance hold was taken for it.
- **Stay in step with the ledger.** A job and its allowance hold are saved together or not at all.

Dazbee runs on one server, with Postgres 16 in a container capped at 384 MB (ADR-0017, `PRODUCTION.md`). The API reaches it through Drizzle.

## Recommendation

Use **pg-boss**, a job queue kept in the Postgres we already run. This is a recommendation; the owner decides in the AI flow spec.

| Option                                       | Adds                                    | Verdict                                                                                                           |
| -------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Own jobs table with `FOR UPDATE SKIP LOCKED` | Nothing                                 | Lightest, but retries, timeouts and dead-worker checks would be written by hand                                   |
| **pg-boss**                                  | One npm package; tables in our Postgres | **Recommended**                                                                                                   |
| Graphile Worker                              | One npm package; tables in our Postgres | Fastest of the Postgres queues; how fast it takes back a crashed worker's job is not documented on the pages read |
| BullMQ                                       | A Redis server                          | Capable, but a second store to run and back up, and it can't share a transaction with the ledger                  |
| RabbitMQ                                     | A message broker server                 | Too heavy for one shared server, and it can't share a transaction with the ledger                                 |

## pg-boss

From [pgboss.io/api/queues](https://pgboss.io/api/queues), [pgboss.io/api/adapters](https://pgboss.io/api/adapters) and the [README](https://raw.githubusercontent.com/timgit/pg-boss/master/README.md); the site shows version 12.39.0.

- **Requires** Node 22.12 or later and PostgreSQL 13 or later.
- **Saving a job inside our own transaction:** `send()`, `insert()`, `fetch()` and `complete()` take a `db` option. `fromDrizzle(tx, sql)` adapts a Drizzle transaction, and rolling it back rolls the job back. A queue made with `partition: true` behaves differently inside `db` transactions.
- **Dead workers:** with `heartbeatSeconds` (at least 10), a job whose worker stops sending heartbeats is failed and retried.
- **Longest run:** `expireInSeconds`, 15 minutes by default (1 s to 14 days). An expired job follows the same retry rules as a failed one.
- **Retries:** `retryLimit` 2 by default, `retryDelay` 0 s, `retryBackoff` off; exponential backoff and `retryDelayMax` are available.
- **Also:** priority, cron and RRULE schedules, queue policies for rate limiting, debouncing and concurrency, dead-letter queues with redrive, and OpenTelemetry.

## The alternatives

### Graphile Worker

From [its performance page](https://worker.graphile.org/docs/performance) and [home page](https://worker.graphile.org/).

- Uses `LISTEN/NOTIFY` to learn of new jobs and `SKIP LOCKED` to take them; jobs start within milliseconds.
- Its maker measured about 15,600 jobs a second unbatched and about 184,000 batched, on one i9-14900K running both workers and database. The home page claims up to 10,000 a second.
- Retries 25 times over about 3 days by default, with exponential backoff. Has cron, priority, job keys for de-duplication, and `add_job` in plain SQL.
- No built-in rate limiter; a third-party package adds one.
- A worker that exits without shutting down leaves the jobs in its local batch queue locked until a 4-hour limit runs out. The pages read don't say how fast other crashed jobs are taken back; the paid Pro edition is named as the fix.
- Requires PostgreSQL 12+ and Node 22.18+.

### BullMQ

From [Going to production](https://docs.bullmq.io/guide/going-to-production) and [Stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs).

- Needs Redis with `maxmemory-policy noeviction`, "the only setting that guarantees the correct behavior of the queues", and AOF persistence is recommended.
- A killed worker's job is marked stalled and run again after about 30 s.

### RabbitMQ

From the [production checklist](https://www.rabbitmq.com/docs/production-checklist), [Consumers](https://www.rabbitmq.com/docs/consumers) and [Confirms](https://www.rabbitmq.com/docs/confirms) (version 4.4 docs).

- Asks for at least 4 CPU cores and 4 GiB of RAM per node, not shared with other data services. A single node is called sufficient for development, integration testing and some QA.
- Not losing messages needs durable or quorum queues, publisher confirms and manual acknowledgements.
- An unacknowledged delivery goes back to the queue after 30 minutes by default; since 4.3 that timeout applies only to quorum queues.

## Is Postgres fast enough?

The AI flow will run a few jobs a minute for a long time. Published numbers for Postgres queues range from a few hundred to tens of thousands of jobs a second, set mostly by disk flushes, worker count and hardware ([DBOS](https://dbos.dev/blog/making-postgres-queues-scale), [a Postgres vs RabbitMQ test at 5,000 messages a second](https://dev.to/michael_sun_18a5c4c96768d/postgres-skip-locked-at-5k-messagessecond-vs-rabbitmq-our-production-benchmark-numbers-36h)). Microsoft warns that at thousands of jobs a second the queue's writes alone can swamp the database's write-ahead log ([Potential consequences of using Postgres as a job queue](https://techcommunity.microsoft.com/blog/adforpostgresql/potential-consequences-of-using-postgres-as-a-job-queue/4514332)). Reaching that rate is the sign to move the queue out of Postgres.
