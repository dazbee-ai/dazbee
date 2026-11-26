# The AI task layer: how products pick the model, prompt and settings for each AI call

## 1. The question

For each AI call, something decides which model runs it, with which prompt (at which version) and which settings. How do mature AI products structure that layer, roll changes out and back, test and target them, estimate and meter cost and time, and tie a prompt version to the model it was tested with? And what should Dazbee's version of it be?

"Task" is the question's word. In Dazbee the unit is the **AI step** (GLOSSARY.md), and this note keeps that word; "task" is on the avoid list for an AI job.

Every source was read on 26 Nov 2026. Quotes are short and come from the page linked beside them.

## 2. How each product does it

### LaunchDarkly AgentControl (was AI Configs)

LaunchDarkly renamed the product: "AgentControl was previously called AI Configs." "This product name has changed, but the API has not." ([API docs](https://launchdarkly.com/docs/api/agentcontrol))

- **Unit.** A config, "a single resource that you create in LaunchDarkly to control how your application uses large language models", with "one or more variations" ([overview](https://launchdarkly.com/docs/home/ai-configs)).
- **What a variation holds.** "A unique combination of model settings and prompt content": a model, parameters "such as `temperature` or `max_tokens`", custom parameters as JSON, messages (completion mode) or instructions and tools (agent mode), with `{{ variables }}` filled at runtime ([create a variation](https://launchdarkly.com/docs/home/agentcontrol/create-variation.md)). Prompt and model live in the same variation.
- **Versions and rollback.** A variation has versions; an earlier one is brought back with "Promote vX to current", which saves it as a new version ([compare versions](https://launchdarkly.com/docs/home/agentcontrol/compare-variation-versions.md)).
- **Targeting and rollout.** Rules on "any context kinds and any context attributes", a percentage rollout per rule, and a default rule for everyone else. Guarded rollouts watch metrics and "can pause the release or restore the previous variation automatically" ([targeting](https://launchdarkly.com/docs/home/agentcontrol/target.md)). LaunchDarkly's own guide serves a premium variation when `customer_type` "is one of" premium and a free one by default ([tier guide](https://launchdarkly.com/docs/guides/agentcontrol/targeting-python)).
- **Experiments.** They "measure how config variations affect end-user behavior using the metrics you define"; a guarded rollout and an experiment can't run on the same flag at once ([experimentation](https://launchdarkly.com/docs/home/agentcontrol/experimentation.md)).
- **Cost and time.** The SDK tracker records duration, tokens, success, errors, time to first token and feedback. The metrics page doesn't mention cost ([AI metrics](https://launchdarkly.com/docs/sdk/features/ai-metrics.md)).
- **Where it lives.** Hosted. The app fetches the config on every generation (`completionConfig()` in Node) and passes a fallback in code, used "when an error occurs" ([SDK](https://launchdarkly.com/docs/sdk/features/ai-config.md)).

### Langfuse prompt management

Langfuse was bought by ClickHouse on 16 Jan 2026. Its FAQ says "No licensing changes planned" and "Self‑hosting is a first‑class path" ([announcement](https://langfuse.com/blog/joining-clickhouse)).

- **Unit.** A prompt by name, fetched by label or by version: `{ version: 1 }` or `{ label: "staging" }`; asking for both is a 400 ([version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control)).
- **What it holds.** Text or chat messages, plus a config: "an optional arbitrary JSON object attached to each prompt", used for the model, its parameters, output schemas and tools. "Because the config is versioned together with the prompt, you can manage all parameters in one place." ([config](https://langfuse.com/docs/prompt-management/features/config))
- **Versions, labels and rollback.** "Versions provide an immutable history of every change." `production` is the default label, `latest` points to the newest version, and custom labels serve "staging, testing, tenants, or A/B tests". To roll back, "reassign the production label back to a previous version" ([concepts](https://langfuse.com/docs/prompt-and-skill-management/concepts)). Protected labels are an Enterprise feature, or a Teams add-on on Pro ([version control](https://langfuse.com/docs/prompt-management/features/prompt-version-control)).
- **A/B.** Label two versions (`prod-a`, `prod-b`) and pick one at random in the app's own code ([A/B testing](https://langfuse.com/docs/prompt-management/features/a-b-testing)).
- **Cost and time.** Calls are linked to the prompt version, and each version shows median latency, input and output tokens, "Median generation costs" and scores ([link to traces](https://langfuse.com/docs/prompt-management/features/link-to-traces)). Cost is either sent by the app or worked out from a model definition that "stores a price per usage type", matched to the model name by a pattern, with pricing tiers. Price changes are not applied backwards: "Generations already stored keep the cost calculated at ingestion time." ([cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking))
- **Where it lives.** Hosted or self-hosted. The SDK caches a prompt for 60 s and serves a stale one while it refreshes, so "your first few traces after updating a prompt might still be using the old version" ([caching](https://langfuse.com/docs/prompt-management/features/caching), [concepts](https://langfuse.com/docs/prompt-and-skill-management/concepts)). Self-hosting needs two containers plus PostgreSQL, ClickHouse, Redis or Valkey, and S3 ([self-hosting](https://langfuse.com/self-hosting)).

### PromptLayer

- **Unit and contents.** A prompt template: "a reusable, versioned prompt definition that can include your messages", with variables and model settings, run by name and release label (`prompt_release_label="prod"`) ([registry](https://docs.promptlayer.com/features/prompt-registry/overview)).
- **Versions.** "Each save creates a new version", with a commit message ([editor and versioning](https://docs.promptlayer.com/features/prompt-registry/prompt-editor-versioning)).
- **A/B and targeting.** An A/B release splits one label across versions by percentage ("The percentages must add up to 100%"), and segments defined "using request metadata (e.g., user ID, company)" can get versions of their own. The page warns to log the version served, since "The label will always point to the original version in your logs." ([dynamic release labels](https://docs.promptlayer.com/features/prompt-registry/dynamic-release-labels))
- **Cost.** The pages read don't cover cost per version.

### Braintrust

- **Unit and contents.** A prompt by slug. Its definition includes "The model to call and settings like temperature and max tokens"; prompts can be defined in code and pushed with the `bt` CLI ([write prompts](https://docs.braintrust.dev/evaluate/write-prompts)).
- **Versions.** "Every change to a prompt creates a new version", and "by default" the app uses the latest. Code pins one with `version`, or loads the version assigned to an environment ([versions](https://docs.braintrust.dev/evaluate/prompts/versions)).
- **Failures.** On a network failure the TypeScript and Python SDKs "return the last cached copy", but loads that name a `version` or `environment` "never fall back to the cache" ([deploy prompts](https://docs.braintrust.dev/deploy/prompts)).

### Helicone

- **Unit.** A request sends `prompt_id`, `inputs` and an optional `environment` (production by default); "The prompt template lives in Helicone, not your code", and the request still names the `model` ([prompt integration](https://docs.helicone.ai/gateway/prompt-integration)).
- **Cost.** Per-request cost from its own price list, sliced by custom properties such as `"Helicone-Property-Feature"` ([cost tracking](https://docs.helicone.ai/guides/cookbooks/cost-tracking)).
- **Status.** Mintlify bought Helicone on 3 Mar 2026; "Helicone will continue operating in maintenance mode", with security fixes and new models only ([Mintlify](https://www.mintlify.com/blog/mintlify-acquires-helicone)). Not a candidate to build on.

### Portkey

- **Prompts.** Called as `prompt-id` (the published version), `prompt-id@12`, `prompt-id@latest` or `prompt-id@production`. "Each version is immutable once created"; `production`, `staging` and `development` labels can't be removed, and an earlier version is brought back with Restore or Publish ([versioning](https://portkey.ai/docs/product/prompt-engineering-studio/prompt-versioning)). A saved prompt keeps its model and parameters (`"model": "gpt-4"`, `"temperature": 0`) ([prompt API](https://portkey.ai/docs/product/prompt-engineering-studio/prompt-api)).
- **Configs.** A separate JSON object for "fallbacks, load balancing, retries, caching", saved with an id and attached to a request or as an API key's default ([configs](https://portkey.ai/docs/product/ai-gateway/configs)). Conditional routing checks metadata or request parameters in order, such as `"metadata.user_plan": { "$eq": "paid" }`, with a default target ([conditional routing](https://portkey.ai/docs/product/ai-gateway/conditional-routing)). The configs page doesn't say whether configs are versioned.

### LiteLLM

- **Unit.** A model group: entries in `model_list` that share a `model_name` ("model alias -> loadbalance between models with same `model_name`"), routed by `simple-shuffle` (the recommended default), latency, cost or usage, with ordered fallbacks, retries and per-deployment cooldowns ([routing](https://docs.litellm.ai/docs/routing)). No prompt.
- **Budgets.** Per key, team, user and customer, with `max_budget` and `budget_duration`. Budget reservation is on by default: LiteLLM estimates a request's most cost (from `max_tokens` where given), reserves it, rejects the request "before sending it to the provider" when it would pass the budget, and afterwards "replaces the reservation with the actual cost". For routes without token pricing, "such as some image and audio routes", it can't reserve and checks recorded spend instead ([budgets](https://docs.litellm.ai/docs/proxy/users)).
- **Cost.** Spend per request in the `LiteLLM_SpendLogs` table and the `x-litellm-response-cost` header; spend by tag is marked Enterprise ([cost tracking](https://docs.litellm.ai/docs/proxy/cost_tracking)).
- **Supply chain.** Releases 1.82.7 and 1.82.8 on PyPI were compromised on 24 Mar 2026 ([issue](https://github.com/BerriAI/litellm/issues/24518)), and 1.107.0 on 21 Oct 2026, Docker images included ([issue](https://github.com/BerriAI/litellm/issues/47826)). A proxy holds every seller's key, so this counts.

### OpenRouter

- **Presets.** A preset manages "Model selection", "System prompts", "Generation parameters" and provider routing, called as `@preset/slug` or `model@preset/slug`. "Version history is kept so you can understand changes that were made and roll back", but through the API "the latest version is always used" ([presets](https://openrouter.ai/docs/features/presets)).
- **Sellers.** The `provider` object takes `order`, `allow_fallbacks`, `only`, `ignore`, `sort` and `max_price` ([provider routing](https://openrouter.ai/docs/features/provider-routing)).
- **Cost.** Every response carries `usage.cost`, "The total amount charged to your account", and a generation can be looked up later by id ([usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting)).

### Vercel AI Gateway and AI SDK

- **Unit.** A `creator/model` string, or a virtual model `vmc/<slug>`: "a saved AI Gateway model configuration" pairing a model with provider order, fallbacks, fast mode, service tier, caching, provider options (such as `{ "anthropic": { "effort": "high" } }`) and tags. It holds no prompt. Changes reach new requests "within a few minutes"; a virtual model can be archived and restored; the page describes no version history. The result names the virtual model in `providerMetadata.gateway.virtualModelConfig.modelId` ([virtual models](https://vercel.com/docs/ai-gateway/models-and-providers/virtual-models)).
- **Sellers.** `order` tries the listed providers first and may fall back to others; `only` is "a hard filter" ([provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options)).
- **Cost.** Each request's cost is in the request logs, and `getGenerationInfo` gives `totalCost` and `marketCost` ([AI SDK gateway provider](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)). Budgets are checked "before each request", but "A budget is a soft cap, not a hard limit", and "Budgets limit usage; they do not reserve or purchase capacity" ([budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets)).

### OpenAI

- **Hosted prompts end.** "`v1/prompts` is scheduled to shut down on November 30, 2026." OpenAI says to move prompt content "into your application code" and to "Move versioning to your repo using git commits, PR review, and tests or evals", with prompts in a small `prompts/` module and "lightweight eval fixtures so prompt changes are reviewed like product logic" ([migration guide](https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object.md)). The deprecations page gives the notice date as 3 Jun 2026; the Evals dashboard and API and Agent Builder shut down on the same day ([deprecations](https://developers.openai.com/api/docs/deprecations.md)).
- **Prompts and models belong together.** OpenAI recommends "Pinning your production applications to specific model snapshots" and tests that "measure prompt behavior", because "different models might need to be prompted differently" and "Even different snapshots of models within the same family could produce different results" ([text generation](https://developers.openai.com/api/docs/guides/text.md)).
- **Prompt caching.** On by default; "Cache reuse requires the entire rendered prefix to match", so stable instructions go first; at least 1,024 tokens for GPT-5.6 and later; cached input is "discounted up to 95%" ([prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching.md)).

### Anthropic

- **No general prompt registry.** The old prompt-templates page now redirects to the prompting best practices. Those say prompts carry over between models only with changes: newer models "might overtrigger on instructions that were needed for previous models" ([best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).
- **Managed Agents versions.** "Every `agents.update` produces a new immutable version." A plain agent id gets the latest version, while `{"type": "agent", "id": ..., "version": ...}` "pins to an exact version". "Rolling back isn't a deploy; callers just go back to passing `version: 1`." "Creating versions is exploratory; updating the production pin is what goes through review." It also warns that callers passing the bare id "will start using the new prompt on their very next session" ([versioning cookbook](https://platform.claude.com/cookbook/managed-agents-cma-prompt-versioning-and-rollback)). A session can also override the model or system prompt for itself alone "without versioning the agent", and its response still names the base version ([sessions](https://platform.claude.com/docs/en/managed-agents/sessions)).
- **Prompt caching.** "Cache prefixes are created in the following order: `tools`, `system`, then `messages`"; changing tool definitions "invalidates the entire cache"; the shortest prefix that can be cached is 512 to 4,096 tokens, depending on the model; the default lifetime is 5 minutes ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).

### First-party write-ups from multi-model products

- **GitHub Copilot.** Auto picks a model per request from "real-time model health" ("availability, utilization, speed, error rates, and cost") and a router, HyDRA, that "identifies models that can meet the quality bar for the task, then chooses the best fit among them", trained on scored answers from a weaker and a stronger model ([GitHub blog, 17 Jun 2026](https://github.blog/ai-and-ml/github-copilot/getting-more-from-each-token-how-copilot-improves-context-handling-and-model-routing/)). Plans meter by model: "Each model has a premium request multiplier"; Pro includes "300 per month" premium requests and Pro+ "1500 per month" ([premium requests](https://docs.github.com/en/copilot/concepts/billing/copilot-requests)).
- **Uber.** One gateway for every LLM use at Uber, with audit logs for "comprehensive cost attribution" and budgets per team; the post doesn't cover prompts, fallbacks or caching ([Uber, 11 Jul 2024](https://www.uber.com/blog/genai-gateway/)).
- **Image and ad products.** No first-party engineering write-up was found that describes how an image or ad product configures model, prompt and settings per feature or plan. Adobe's help pages on credits per partner model refused to load (HTTP 403), so they are not used here.

### Comparison

| Product                   | Unit the app names                  | What the unit holds                                               | Roll out and roll back                                                                 | A/B and targeting                                                  | Cost and time                                                 | Where it lives                    |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------- |
| LaunchDarkly AgentControl | Config key                          | Variation: prompt, model, parameters, tools, all versioned        | Rules and percentage rollouts; guarded rollout can undo itself; promote an old version | Rules on any context attribute (plan); experiments on user metrics | Tokens, duration, success, feedback; no cost                  | Hosted; fallback in code          |
| Langfuse                  | Prompt name + label or version      | Prompt and config (model, parameters, schema), versioned together | Move a label                                                                           | Labels picked at random by the app                                 | Latency, tokens, cost and scores per version; own price table | Hosted or self-hosted; 60 s cache |
| PromptLayer               | Template + release label            | Messages, variables, model settings                               | Each save a version; move a label                                                      | Percentage split and metadata segments                             | Not on the pages read                                         | Hosted                            |
| Braintrust                | Slug + version or environment       | Messages, model, parameters                                       | Latest by default; pin a version or environment                                        | Not on the pages read                                              | Logged when Braintrust runs the call                          | Hosted; can push from code        |
| Helicone                  | `prompt_id` + environment           | Messages; the model is in the request                             | Rollback claimed, not described                                                        | Not on the pages read                                              | Own price list; properties per feature                        | Hosted; maintenance mode          |
| Portkey                   | `id@version` or `@label`; config id | Prompt with model and parameters; config with routing             | Immutable versions, labels                                                             | Conditional routing on metadata such as plan                       | Not on the pages read                                         | Hosted                            |
| LiteLLM                   | Model group alias                   | Deployments and routing; no prompt                                | Edit the proxy's config                                                                | Model access per key or team                                       | Spend log, reserve then actual cost, budgets                  | Self-hosted proxy                 |
| OpenRouter                | Model slug or `@preset/slug`        | Preset: models, system prompt, parameters, seller routing         | History and rollback; API uses latest                                                  | None                                                               | Cost in every response                                        | Hosted                            |
| Vercel AI Gateway         | `creator/model` or `vmc/slug`       | Model, seller routing, fallbacks, options; no prompt              | Edit within minutes; archive and restore                                               | None                                                               | Cost per request; soft budgets                                | Hosted                            |
| OpenAI (now)              | Code                                | Prompt in the repo; model pinned in the call                      | git and pull requests                                                                  | None                                                               | Usage in the reply                                            | Code                              |
| Anthropic Managed Agents  | Agent id + version                  | Model, system prompt, tools                                       | Immutable versions; callers name the version                                           | Per-session override                                               | Session budgets                                               | Hosted                            |

## 3. Patterns that recur, and where products disagree

**The app names a stable thing, never a model.** Every product puts a name between the code and the model: a config key, a prompt name, a slug, an alias, a `vmc/` id. Changing the model is a change of data, not of code.

**Versions don't change; a pointer moves.** Langfuse ("an immutable history"), Portkey ("immutable once created"), Braintrust ("Every change to a prompt creates a new version"), PromptLayer and Anthropic ("a new immutable version") keep every version and move a label, an environment or a caller's version number to roll out or back. Rollback is moving the pointer back, never an edit. LaunchDarkly brings an old version back by saving it as a new one.

**The version that served each call is recorded.** Langfuse links calls to prompt versions, PromptLayer warns that a label alone hides which version ran, Vercel returns the virtual model that served a request, and LaunchDarkly's tracker belongs to the config it came from. Without it, cost and time can't be compared between versions.

**Production names an exact version, or knows it gets the latest.** Anthropic's cookbook makes the version number "the change-control point" and warns about callers passing a bare id; Braintrust's pinned loads never fall back to a cached copy. Where a product serves the latest by default (Braintrust, OpenRouter's API, a bare Anthropic agent id), its docs warn about it.

**Targeting reads facts about the request.** LaunchDarkly rules read context attributes such as a customer type; Portkey conditions read `metadata.user_plan`; PromptLayer segments read request metadata. A plan is one more fact.

**Cost comes from the usage the seller reports times a price table the product keeps**, or from the gateway's own bill (OpenRouter's `usage.cost`, Vercel's `totalCost`). Langfuse doesn't reprice the past when a price changes, as ADR-0023 doesn't.

**Spending is checked before the call, but a hold is rare.** LiteLLM reserves a request's most cost and settles it afterwards, which is close to Dazbee's hold, but only for token-priced routes. Vercel checks budgets before each request and lets the request that crosses one finish. Anthropic's session budgets stop a session between model requests.

**None of the products read estimates time before a call.** Time is measured after the fact: LaunchDarkly's duration, Langfuse's median latency per version, Vercel's request logs. Copilot routes on live speed, but shows no wait. Showing "about how long" before a job is Dazbee's own work, and the call log is the place to learn it from.

Where they disagree:

- **Prompts in code or hosted.** The hosted tools (Langfuse, PromptLayer, Portkey, Helicone, LaunchDarkly) keep prompts outside the code so they change without a deploy. OpenAI is closing its hosted prompts and says to keep prompts in the repo with review and tests. Braintrust takes both, defining prompts in code and pushing them. Hosted prompts bring reads that can be stale (Langfuse's 60 s cache, LaunchDarkly's fallback "when an error occurs").
- **Model bundled with the prompt version, or routed apart.** Prompt tools version the model with the prompt (LaunchDarkly's variation, Langfuse's config, Portkey's saved prompt, Anthropic's agent version). Gateways version the route without the prompt (Vercel's virtual models, LiteLLM's model groups, Portkey's configs); OpenRouter's presets carry a system prompt. The model makers side with the bundle: OpenAI says "different models might need to be prompted differently", and Anthropic says instructions needed for older models make newer ones overtrigger. Across the products, the choice of model goes with the prompt, and the choice of seller for that same model is routed apart.
- **What is tested.** LaunchDarkly tests variations against what people do afterwards; Langfuse leaves the random split to the app; PromptLayer splits by percentage and segment; Copilot trains a router. None of these decides for us what counts as a better ad.

## 4. How Dazbee worked when this was read

Read from the `ai-step-effort` branch (the open pull request with the newest settings); `main` lacks its reasoning effort, fast tier and Terra settings, and is otherwise the same in what follows.

**The unit is the AI step,** listed in `AI_STEPS` (`packages/schema/src/ai.ts`) and `STEPS` (`packages/ai/src/steps.ts`). An AI step runs its own model from `ai_step_models` or its kind's default from `ai_kind_models`, each with an `options` JSON such as `{"effort":"low","tier":"fast"}` or `{"quality":"medium"}` (`packages/db/src/ai-tables.ts`, `stepModel` in `steps.ts`). The admin page changes a step's model or options in place (`apps/api/src/admin/ai-model-routes.ts`), with no history.

**Prompts are code.** The words are in `packages/ai/src/prompts/ads/*.ts`, each with a version constant (`ROUND_DIRECTOR_VERSION = 'v7'`, `ROUND_DIRECTOR_LIGHT_VERSION = 'light-3'`). `packages/ai/src/prompts/ads/ads.test.ts` checks a sha256 of each prompt's words and each version name, so words can't change without a test changing. The prompt is chosen in code: `MODE_STEPS` in `packages/ai/src/flow/round.ts` maps Fast to `flow.round-plan`, `flow.draft-fast` and the light director, and Precise to `flow.round-plan-full`, `flow.draft-precise` and the full director.

**Expected size and time are code.** A text step's input, output and ceiling are in `STEPS`; each step's seconds are in `STEP_SECONDS`, both in `steps.ts`. The admin page shows each text step's measured average and p95 tokens over 30 days beside its set sizes, grouped by step and model (`measuredSizes` in `ai-model-routes.ts`), for a person to copy by hand.

**Holds and routes.** A job's hold is priced when it is asked for, from the calls its kind declares (`packages/ai/src/flow/holds.ts`), each at the step's current model and the dearest priced seller, times 1.25 (`holdFor` in `steps.ts`). The worker reads the step's model again when it makes each call (`routeStep`, called from `callAi` in `packages/ai/src/call.ts`). Sellers are ordered per model (`model_sellers`) and priced per seller, model, unit and tier (`ai_prices`). The ledger and the call log are as ADR-0023 describes.

**What the call log keeps.** Step, model, seller, usage, costs, state and times (`ai_calls`, written by `startTry` in `packages/ai/src/call-log.ts`). Not the options, not the prompt's version, and nothing that ties the call to the setting it ran with.

**Settings arrive by migration.** `packages/db/migrations/0020_ai-text-step-options.sql` seeds step models and options with conditions that keep whatever an admin set, because a migration can't tell an admin's choice from a seed.

Against the patterns:

| Pattern                                       | Dazbee today                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The app names a stable thing                  | Yes: the AI step. But the mode is in the name (`flow.draft-fast`, `flow.round-plan-full`), so the name is not stable when modes change.     |
| Prompt and model chosen together              | No. The prompt is chosen in code by mode; the model in the database by step. Changing a model doesn't know which prompt it was tested with. |
| Versions don't change; a pointer moves        | No. A step's row is edited in place; there is no history and no rollback. Prompt versions exist in code, unrecorded.                        |
| The version that served each call is recorded | Partly: step and model, not options or prompt version. Measured sizes mix every effort and every prompt version of a model.                 |
| A job keeps the setting it was priced with    | No. The hold is priced from the model when the job is asked for; the call runs whatever model the step has when it is made.                 |
| Targeting reads facts about the request       | Only the mode, by step name. The layer size by grant (`ai_grants.layer_size`) is the one plan-like fact.                                    |
| Cost from reported usage and our own prices   | Yes, stronger than most: per seller and tier, add-only ledger, daily check against the sellers' bills.                                      |
| Spending checked before the call              | Yes: the hold, stronger than any product read (a hold on every kind of call, given back).                                                   |
| Time estimated before a job                   | Yes, but from constants, which a model swap leaves wrong.                                                                                   |
| Prompts in code with tests                    | Yes, as OpenAI now recommends.                                                                                                              |

The owner's four pains follow from the "No" rows: a model swap leaves `STEP_SECONDS`, `STEPS` sizes and holds wrong because they are constants keyed by step, not by what runs; a model change isn't tied to a prompt because the two are chosen in different places; nothing can be rolled back because rows are edited in place; and modes leak into step names because the step row is the only place a model can be set.

## 5. Three more groups of products

Read on 26 Nov 2026, from each product's docs or its repo's default branch. Quotes came through a page reader, so treat their wording as near-exact.

### Code-first frameworks and prompt files

- **Vercel AI SDK 7** has no named unit of its own. A call is named by a model alias and a `functionId` on its telemetry: "You can also provide model name aliases, so you can update the model version in one place in the future" ([provider management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)). The prompt is not bundled with the alias, and the docs describe no fallbacks, prompt versions or cost ([telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)).
- **Genkit and Dotprompt.** A `.prompt` file holds the model, its config, the input and output schema and the template: "Dotprompt is designed around the premise that prompts are code." Variants are files named `[name].[variant].prompt`, and the variant is written to traces ([Dotprompt](https://genkit.dev/docs/dotprompt/)). A flow wraps the calls of one feature ([flows](https://genkit.dev/docs/flows/)).
- **Microsoft Prompty** is "a markdown file format (`.prompty`) for LLM prompts", whose front matter names the model and its options ([repo](https://github.com/microsoft/prompty)).
- **BAML** (its v0 docs). A typed function names its input and output types, its client and its prompt; a client holds the provider, its options, a retry policy, or a fallback list: "A fallback will attempt to use the first client, and if it fails, it will try the second client, and so on." ([what is BAML](https://docs.boundaryml.com/guide/introduction/what-is-baml), [fallback](https://docs.boundaryml.com/ref/llm-client-strategies/fallback)). Its collector gives tokens and duration, not cost.
- **Mastra.** An agent holds instructions and a `provider/model` string; steps are "the building blocks of workflows" ([agents](https://mastra.ai/docs/agents/overview), [workflows](https://mastra.ai/docs/workflows/overview)). Its editor keeps drafts and a published version of an agent.
- **DSPy, Pydantic AI, the OpenAI Agents SDK and LangChain** name a module, an agent or nothing at all, and set the model beside the prompt or apart from it ([DSPy](https://dspy.ai/current/getting-started/installation/), [Pydantic AI](https://pydantic.dev/docs/ai/core-concepts/agent/), [OpenAI Agents](https://openai.github.io/openai-agents-python/agents/), [LangChain](https://docs.langchain.com/oss/python/langchain/models)).
- **OpenAI's own guidance:** "Create a small `prompts/` module, keep each prompt as a named builder function, and add lightweight eval fixtures", and "rollout or experimentation can be managed through your own config or feature flags" ([migration guide](https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object)).

None of these declares an expected size or time for a call up front. "Step" appears only as a part inside a workflow or a trace, never as the thing the app names.

### Products whose code or admin docs are public

- **GitLab Duo.** Each feature setting has default models and the models an admin may select, in a YAML file in the gateway's repo; prompts are files per action and model family, picked by a version query: "AI Gateway will fetch the latest stable version available that matches the prompt version query passed as argument." ([model switching](https://docs.gitlab.com/development/ai_features/model_switching/), [actions](https://docs.gitlab.com/development/ai_features/actions/)). Rollback is by feature flag.
- **Supabase** keeps its model choices as named constants in one file: "Single source of truth for all Assistant chat model variants and their reasoning levels." ([model.utils.ts](https://github.com/supabase/supabase/blob/master/apps/studio/lib/ai/model.utils.ts)).
- **PostHog** names the model in code at the call, and its prompts are constants ([llm.py](https://github.com/PostHog/posthog/blob/master/ee/hogai/llm.py)).
- **tldraw's agent kit** has modes and one code table of model definitions ([models.ts](https://github.com/tldraw/tldraw/blob/main/templates/agent/shared/models.ts)).
- **Twenty, Discourse and Mattermost** keep an agent as a database row with its prompt and model, because each customer's admin brings their own models ([Twenty](https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/metadata-modules/ai/ai-agent/entities/agent.entity.ts), [Discourse](https://github.com/discourse/discourse/blob/main/plugins/discourse-ai/app/models/ai_agent.rb), [Mattermost](https://docs.mattermost.com/administration-guide/configure/agents-admin-guide.html)). Discourse logs each call with its feature's name, model, tokens, estimated cost and duration.
- **Open WebUI** keeps versions of a workspace model, with "Set as Production" choosing the live one, and a task model for background jobs ([models](https://docs.openwebui.com/features/workspace/models/), [task models](https://docs.openwebui.com/features/administration/task-models/)). **Dify** versions a whole app ([version control](https://docs.dify.ai/en/cloud/use-dify/build/version-control)). **LibreChat** has model specs written by the admin in a YAML file ([model specs](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/model_specs)).
- **Zed, Continue, aider, Cline and LobeHub** give each feature, role or task slot its own model in a settings file ([Zed](https://zed.dev/docs/ai/agent-settings), [Continue](https://docs.continue.dev/reference), [aider](https://aider.chat/docs/config/adv-model-settings.html), [Cline](https://docs.cline.bot/features/plan-and-act), [LobeHub](https://github.com/lobehub/lobehub/blob/canary/packages/const/src/settings/systemAgent.ts)).
- **Nextcloud** is the one product read where a provider states an expected run time, `getExpectedRuntime()` ([task processing](https://docs.nextcloud.com/server/latest/developer_manual/digging_deeper/task_processing.html)).

The unit is named after what the user gets: a feature, a task, a role, a mode. Where the product's own team writes the prompts, they are in code. Where each customer's admin does, they are database rows.

### First-party write-ups, and image platforms

- **v0** keeps a public model name over a base model that changes: "Our composite model architecture lets us decouple these pieces from the base model." ([Vercel](https://vercel.com/blog/v0-composite-model-family)).
- **Cursor**'s modes are a threshold and a budget for a router, named Cost, Balance and Intelligence, with no models listed ([how the router works](https://cursor.com/blog/how-cursor-router-works), [docs](https://cursor.com/docs/cursor-router)). **Replit**'s are Free, Power and Max ([model selector](https://docs.replit.com/features/agent/model-selector)).
- **A model swap is tested twice:** on replayed real tasks, then on live traffic. Notion replays tasks and has judges compare pairs ([Notion](https://www.notion.com/blog/inside-notions-upgraded-model-router-auto)); Shopify samples its test sets from production ([Shopify](https://shopify.engineering/building-production-ready-agentic-systems)); Lovable runs a candidate inside its own prompts and tools ([Lovable](https://lovable.dev/blog/the-model-picker-is-a-dead-end)); Figma calibrates its judges with designers ([Figma](https://www.figma.com/blog/training-a-figma-fluent-editing-model/)).
- **Provider failover is its own layer**, apart from the choice of model ([Lovable](https://lovable.dev/blog/routing-billions-of-tokens-per-minute)).
- **Image platforms report past time, not a wait or a cost.** fal gives a queue position and the seconds a finished request took ([queue](https://fal.ai/docs/model-endpoints/queue)); Replicate gives `predict_time` ([HTTP API](https://replicate.com/docs/reference/http)); OpenAI's Images API gives token usage and says "Complex prompts may take up to 2 minutes to process" ([image generation](https://developers.openai.com/api/docs/guides/image-generation)); Comfy Cloud sends step progress ([API](https://docs.comfy.org/development/cloud/api-reference)).
- **No first-party engineering write-up was found** for Krea, Leonardo, Recraft, Runway, Pencil, AdCreative or Creatify.

### Metering and allowances

- **Grants with an expiry over an add-only ledger** are how the billing tools model an allowance: Orb's balance is "blocks, which are initialized with an `amount` and `expiry_date`", with "an append-only ledger" ([Orb](https://docs.withorb.com/product-catalog/prepurchase)); Stripe's billing credits have an expiry and "an immutable, append-only ledger" ([Stripe](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)); OpenMeter and Lago void what is left when a grant or wallet expires ([OpenMeter](https://openmeter.io/docs/billing/entitlements/grant), [Lago](https://getlago.com/docs/guide/wallet-and-prepaid-credits/overview)).
- **A hold that is settled later is rare but documented.** LiteLLM: "Budget reservation is enabled by default." ([LiteLLM](https://docs.litellm.ai/docs/proxy/users)). Autumn "atomically checks if the customer has enough balance and reserves it in a single call" ([Autumn](https://docs.useautumn.com/documentation/customers/balance-locking)). Schematic has credit leases and reservations ([Schematic](https://docs.schematichq.com/billing/credit-leases-and-reservations.md)). Stripe, Lago, Orb and Polar describe none.
- **Most gateways let the request that crosses a limit finish.** Vercel: "A budget is a soft cap, not a hard limit." ([Vercel](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets)); Cloudflare records a request's cost "after completion" ([Cloudflare](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)).
- **An allowance in money behind a meter** is what Zed, v0 and Devin Desktop show: Zed's is "measured on a token basis, converted to dollars" ([Zed](https://zed.dev/docs/ai/plans-and-usage), [v0](https://v0.app/docs/pricing), [Devin Desktop](https://docs.devin.ai/desktop/accounts/quota)).
- **Self-hosting a metering tool is heavier than our tables.** OpenMeter needs "Kafka, ClickHouse, and PostgreSQL" ([repo](https://github.com/openmeterio/openmeter)); Flexprice needs Postgres, ClickHouse, Kafka and Temporal ([self-hosting](https://docs.flexprice.io/developers/self-hosting.md)).
- **Public price lists** cover tokens well and pictures unevenly: LiteLLM's file has per-image and per-tier prices ([price file](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)); models.dev has token prices only ([models.dev](https://models.dev/api.json)).
- **None of the sources read describes a daily check** of a call log against each seller's bill.

## 6. What was decided

The owner decided on 26 Nov 2026, and the spec is the AI functions and presets spec (#336).

- **AI functions and presets live in code.** An AI function is a kind of call with its words and the shape of its answer. A preset is a model, its settings and the prompt tested with it, under one name, never edited once merged. This is what the products whose own team writes the prompts do (section 5), and what OpenAI now recommends (section 2).
- **A mode is a list of presets,** named for what it gives and never for a model, as Cursor's, Replit's and v0's are.
- **An admin's pick chooses between presets the code has,** as GitLab's admin picks from the models its code allows. Picks are rows only added, so going back is one pick.
- **Versions in the database were not chosen.** A version there would keep its prompt in git and its model in a table, and would need a check that the two still match.
- **An AI feature is a list of AI functions run in stages,** so a feature on a kind of call we have is its words and a line in that list.
- **A job saves its presets when it is asked for,** and each call is logged with its preset, as the tools in section 3 record the version that served a call.
- **The hold and the wait come from each preset's own measured calls,** since nobody estimates time before a call and every tool measures after it.
- **The money side stays:** grants, the add-only ledger, the hold, the call log, the price list and the daily check. No outside tool, gateway or proxy is used.
