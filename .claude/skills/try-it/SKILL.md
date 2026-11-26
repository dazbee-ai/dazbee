---
name: try-it
description: Use a built ticket's change in the running app the way a person would, with a fresh agent in the browser, before its PR is opened. Use after building a ticket that changes the screen, or when asked to try a change in the app.
---

# Try it

Tests prove the code through its interfaces; nobody has used the screen yet. A **fresh agent** that knows only the ticket uses the change as a **user** does: it clicks what a person would click, not the path the builder had in mind.

Each ticket gets a copy of the app of its own (worktree, database, storage bucket and ports), so try-its for different tickets run at the same time. Tickets 100 apart share ports, and `app.sh` refuses the second while the first runs.

## The AI flow in a copy

The copy runs no worker, so its AI jobs wait. For screen work on the AI flow, run the worker from the ticket's checkout (`node apps/worker/src/main.ts`) with the API's settings from `app.sh` and `AI_REPLAY_DIR=<folder>`: it calls no seller and reads no key, and answers each AI call from that AI recording at no cost, 10 times faster than recorded (`AI_REPLAY_SPEED`). Each replayed job follows one recorded job, the recorded jobs taken in turn, and a call takes that job's recording of its AI step at its place in the job, else another recording of the step, so another brief or size still gets answers; a step never recorded fails its call. The recording is made once, since it costs money, and only with the owner's OK: the same worker with the sellers' keys from the main checkout's `.env` and `AI_RECORD_DIR=<folder>` works as usual and writes each seller answer there. Both are refused with `NODE_ENV=production`.

## Steps

1. **Start the copy.** Commit the ticket's work, since the copy runs a commit. From the ticket's checkout run `bash .claude/skills/try-it/app.sh start <ticket number>`. It runs that commit from a worktree beside the main checkout, with a fresh database, bucket and ports of the ticket's own, and leaves the app the owner runs alone. It starts with the development workspace and its two brands only. When the ticket needs Google fonts, run `app.sh fonts <ticket number> <family>...` for them. Done when it prints the copy's address and the screenshot folder. When it stops on an error, read the log it names: fix a cause in the ticket's code, and bring any other cause to the owner.

2. **Brief one fresh agent** (the Agent tool, general-purpose) with only the ticket number, the copy's address, the screenshot folder and the brief below. Leave out the diff, the code and everything from this conversation. The brief:
   - Read the ticket with `gh issue view`. Use the app through the chrome-devtools browser, in a new page. Read each page with `take_snapshot` and act on its elements; take a screenshot (`take_screenshot` with a `filePath` in the screenshot folder) at the end of each acceptance criterion and at each problem.
   - Do each acceptance criterion as a user, starting from the home page, and make any design or content a step needs through the app.
   - Then do what a user does around the change: empty and very long input, undo and redo, reload, the same design in a second tab, and a phone-size window (390×844).
   - Read the console after each step (`list_console_messages`); an error there is a problem.
   - The copy signs you in as a development user. Report a step that needs real sign-in as not tried.
   - Report each acceptance criterion as passed, failed or not tried, with its screenshot. Report each problem with the steps that reproduce it, what happened, what a user would expect, its screenshot and any console error.
   - Done when every acceptance criterion has a result.

3. **Verify** each problem by reproducing it yourself in the browser. Done when every problem left is one you reproduced.

4. **Sort** each problem and act on it:
   - **It breaks an acceptance criterion, or sits in code this ticket changed** (`git diff main...<commit>`): fix it on the ticket's branch with a test that fails without the fix, restart the copy on the new commit, and brief a fresh agent again with only the steps that failed. When a step still fails after two rounds of fixes, bring it to the owner.
   - **It comes from code this ticket didn't change:** list it under "Found while trying it" in the PR body, for the owner to decide whether it becomes an issue.
   - **It is a design or wording question, or a case the ticket doesn't define:** bring these to the owner in one numbered round, each with your recommendation, worded so "yes" accepts it.
   - **It doesn't reproduce:** give it one line in the PR body.
   - Done when every problem is fixed, listed or with the owner.

5. **Record and stop.** Add a "Tried in the app" list to the PR body: each acceptance criterion, its result and its screenshot's file name. Run `bash .claude/skills/try-it/app.sh stop <ticket number>`, which also removes the copy's worktree, database and bucket; the screenshots stay in `.try-it/<ticket number>/` in the main checkout. Done when the copy is stopped and the PR body has the list.
