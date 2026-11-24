# AI jobs run in a worker app on pg-boss, and the layer split on a deployed Modal app

This replaces ADR-0008's durable jobs on Temporal Cloud. ADR-0001 already plans the worker app, and ADR-0017 runs it on the one server.

Every AI job runs outside a web request. The API checks the request, sets the job's hold aside from the allowance and saves the job in one database transaction, then answers at once. `apps/worker`, a Node container on the same server with its own memory cap, takes jobs from a **pg-boss** queue kept in the Postgres we already run. It makes each AI call through the one call function, then charges each call and gives back the rest of the hold. Because the queue lives in our database, saving a job and setting its hold aside happen together or not at all. A worker that stops, whether in a deploy or a crash, leaves its jobs to be taken up again by a worker that still runs or the next one that starts. A deploy of the API never cuts a running job, and a deploy of the worker lets its jobs end first. The state people see after a refresh comes from our own jobs table, written in the same transactions, never from pg-boss's tables, which drop finished jobs after a few days.

The layer split runs Ming on an H100 in a **deployed Modal app** with GPU memory snapshots. The worker starts each split by name through Modal's JavaScript SDK, keeps Modal's call id on the AI call, and asks for the result until it comes. A worker that restarts asks again by the same id rather than starting a second split. The app's Python lives in the `python/` uv workspace ADR-0001 plans. CI deploys the app when its code changes, once a repository setting turns that on.

## Considered Options

- **The API runs the jobs itself:** rejected. A blue-green swap of the API would stop running jobs, and a slow job would compete with people's requests for the API's memory.
- **Our own jobs table with `FOR UPDATE SKIP LOCKED`:** the lightest choice, but retries, timeouts and the check for a dead worker would be written by hand.
- **Graphile Worker:** as light as pg-boss, but the pages read don't say how quickly a crashed worker's jobs are taken back, and it has no rate limiter of its own.
- **BullMQ on Redis, or RabbitMQ:** a second store to run and back up on a one-CPU server, and neither can share a transaction with the hold.
- **Temporal Cloud (ADR-0008):** another paid service and SDK, more than a few jobs a minute need.
- **A Modal web endpoint called over HTTP:** a request is cut at 150 s and then has to follow redirects. A spawned call with its id survives a worker restart.

## Consequences

- A job may run twice: pg-boss delivers at least once, and a split may run again after Modal moves it to another machine. Every handler checks what is already done before it calls a seller, and charges each AI call once.
- The server carries one more container. Its memory cap is counted in `deploy/compose.yml`'s total.
- Once the queue has to handle thousands of jobs a second, it moves out of Postgres. That is far beyond what the AI flow needs.
