# AI use is counted in real cost, in an add-only ledger drawn from grants

A workspace's AI use is counted in what its AI calls really cost us, in rupees, not in credits and not at a price per AI function. Each AI call is priced from the usage the seller reports and the price list: the seller's price in the currency it bills in, plus the GST or fee it adds, times the rate an admin sets for that currency, which includes the bank's forex fee. The layer split is the one exception. It takes a fixed amount set by an admin, while the call log still records what the GPU really cost. People see the result only as the usage bar.

The allowance comes in **grants**, each an amount with an expiry, given by a gift, a trial, a plan or a pack. Every change to a grant is a row added to the **allowance ledger** and never changed: a **hold** when an AI job is asked for, a **charge** for each AI call that delivered, and a **give-back** of what the hold didn't use. What is left on a grant is its amount plus the sum of its rows. An AI job is refused when its hold is more than what is left, and it draws from the grant that expires first, then the next. Each grant keeps the **usage rate** of the day it was given, and its charges are the real cost times that rate. An admin's new usage rate therefore reaches each workspace with its next grant, and never changes a grant already given.

**Holds.** A job's hold is what its calls are taken to cost, times 1.25. Each call counts at what one call of its preset costs (ADR-0025): the preset's first guess while it has no done call of its own, the highest cost seen while it has fewer than 20, and from then on the cost that 19 of 20 of its latest 200 stayed under. A call may still cost more than that, on a dearer seller or with a longer answer, and is charged in full. Each call is charged at the speed tier the seller says it ran on. Each text AI function has a ceiling, the most output one call may write, sent to the seller as a hard limit. An answer cut off at the ceiling is our cost: the seller billed it, the call log keeps its cost, no workspace is charged, and the call fails without trying another seller, since the same ceiling would cut it again.

## Considered Options

- **Credits per AI function at a fixed price:** rejected by the owner. People would see a price for each action, and every new AI call would mean pricing a feature again by hand.
- **Billing real cost after use:** rejected. Indian e-mandate rules make charging after use slow and uncertain, so the allowance is paid for first.
- **One balance column per workspace, changed in place:** rejected. There would be nothing to check a balance against, and expiry and the order of grants would be lost.
- **An outside billing engine or AI gateway:** rejected. None can hold and give back an amount, and none sees our own GPU.

## Consequences

- An AI call can cost more than the hold expected. It is still charged in full, so a grant can end a little below zero. The next job is refused until there is room again.
- A price, a rate or a usage-rate change never rewrites the past. Old charges keep the cost and rate they were made at.
- Amounts are kept in whole millionths of a rupee, so sums never round.
