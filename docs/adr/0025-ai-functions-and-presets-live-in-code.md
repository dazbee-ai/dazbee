# AI functions and presets live in code, and an admin's pick chooses between them

Which model an AI call runs, with which settings and which prompt, is a **preset**: a named entry in the code, beside the **AI function** it belongs to and the prompt tested with it. A preset is never edited once merged; new words, another model or another setting is a new preset, and a test fails when one changes under its name. A **mode** is a list in the code that says which preset each AI function uses. The admin page changes only which of the code's presets a mode uses, with a **pick**: rows are only added, the newest is in use, and a job keeps the presets it was asked for with. An **AI feature** is a list of AI functions run in stages, so one runner, one hold and one wait serve every feature.

A prompt and its model belong together: the model makers say a prompt tuned for one model misbehaves on another. Keeping both in one reviewed place is what the products whose own team writes the prompts do, and the research is in `docs/research/ai-task-layer.md`.

## Considered Options

- **A model per AI step in the database, set on the admin page, with the prompt picked in code by mode:** what there was. A model swap left the prompt, the expected sizes and the expected seconds untouched, there was no history, and the mode lived in step names.
- **Versions in the database, each naming a model, its settings and a prompt in code by its hash, with a pointer to the one in use:** rejected. A version would keep half of itself in git and half in a table, so every job would need a check that the two still match, and an admin could pair a model with a prompt nobody tested.
- **Prompts in the database too, edited on the admin page:** rejected. The words would leave review and their tests.
- **An outside prompt tool or gateway:** rejected. None holds an allowance or sees our own GPU, and a job would have to agree with it on every call.

## Consequences

- A new model or new words reach production by a merge, about as long as a deploy takes. Switching between presets that exist is one pick, live for the next job.
- An old preset stays in the code for as long as a pick may point back at it.
- A pick whose preset the running code doesn't have is not used: the mode's own preset runs, and the admin page says so.
- A preset's cost and seconds come from its own done calls, from the first one, so nothing about size or time is written by hand beyond a preset's first guess.
