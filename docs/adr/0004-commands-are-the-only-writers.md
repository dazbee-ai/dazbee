# Commands are the only way to change a design

Overrides were taken out on 2026-11-04 (ADR-0014). Undo, gestures and faults were changed on 2026-11-14, when designs moved off Yjs (ADR-0015), and the writes only the Yjs store made (an undo putting back what Yjs left unset, and compaction) went with it; the rest stands.

Nothing writes to a design except a command in `packages/doc`, through the store (whole records, one value of a record, text edits). The one exception is the follow-up, below. A command is a zod input plus a function, and it runs as one step. The step ends as one change set that the sync server accepts or rejects whole, and as one undo step. The UI, shortcuts, the assistant, importers and AI jobs all call the same commands. AI jobs save their result, and a tab with the design open writes it in as an **arrival**: commands run untracked (`session.untracked`), as one change set that no undo or redo of any tab takes back, the tab's own included. A result costs money, so Ctrl+Z must never remove it. The server never writes it itself (ADR-0015): a write made there would be no tab's change set, checked and ordered as every other is.

## Gestures

A drag runs a command on every pointer move, and typing runs one per key. Undoing those one by one would take dozens of steps, so the editor wraps them in a gesture (`session.beginGesture()`, see GLOSSARY.md). The commands run in it are one step: one undo step, and one change set when the gesture ends. A gesture changes only how commands are grouped; every write is still a command. Other tabs draw an open gesture's preview (the layers it changed so far, for display only: their panels, selection, hit tests and commands read the design without it) and apply its change set once it ends. A typing session is a gesture until the person leaves the text, pauses for 2 seconds or hides the tab; the next key opens another, so Undo takes back a burst at a time and other tabs get the text while the person still types.

Each step has a name from one list of step names in `packages/doc` (`move`, `rename`, `align`, ...), which Undo and Redo show. A command names the step it makes; a gesture or a batch may name its own, and one that does not takes its first command's name. The name travels with the step through undo and redo, and `undoName()` and `redoName()` give the name of the step on top of each stack.

Undo follows FigCraft's rules, with the departures in the spec on #677 (D5, C31):

- An undo writes back what its step replaced, for every value no other tab has written since, in server order.
- An undo deletes only records its step created. It never takes what another tab placed in them since (C46).
- An undo or redo goes out only from the front of the tab's queue, made again from the confirmed design when it gets there.
- A step that can't be written yet, because the holder of a record it brings back is gone, waits. Undo and Redo skip it and take the step below.
- A step taken back only in part splits: the part taken back moves to the other stack, and the rest waits.
- When the server rejects a step's change set, the step leaves both stacks, and a notice says why. An undo or redo rejected because another tab's change broke a rule waits instead.

Each press moves at least one value or record between the stacks, so undo and redo always run out.

The history holds 1,000 steps. A step whose change set is still in the queue outlives the cap. A step that changed nothing makes no undo step, and leaves redo as it was.

An open gesture counts on the stacks once a write in it has changed the design: Undo is offered with its name, and Redo is not. A press of Undo while a gesture is open ends what the gesture wrote so far as a step of its own, and takes it back. The gesture stays open, and a later cancel puts back only what it wrote after the press. A press with nothing to take back leaves the gesture whole. The history listeners are told once after every undo, redo and put-back, when the stacks are whole again.

A batch (`session.batch()`) runs commands as one step, so a batch outside a gesture is one change set. Inside a gesture, it joins the gesture's step: a drag of many layers runs one batch per move, and sends one change set when it ends. A batch's commands all read the design from before it, so a batch takes only commands that change properties of layers, frames or pages that exist. Each command says so where it is defined (`batchable`). A command that adds, removes, moves, reorders or re-parents a layer, a frame or a page is refused in a batch, before anything is written. Such steps run in a gesture, one after another, as one undo step.

## Exception

A design may be written outside a command in one case: a follow-up. After another tab's change set is ordered before its own, the tab's sync client works out the derived values again (a text's box, a group's box) and sends them as a change set of their own (`derived-values.ts`, through `sync/follow-up.ts`). It writes only derived values, never what a person set. It makes no undo step, and nobody is told when it is rejected. The server never makes one.

A fault (`CommandFault` in `packages/doc`) is put back, which writes nothing. A bug in a command can make its `apply` throw halfway, write a value the schema does not take, or leave a design in need of a repair that read without one before. In a design the read already repairs, a repair after a command is no fault: two tabs can leave such a design with no bug anywhere, each moving a layer into the other's, and a sound command there can shift what the repair does. The session puts back the open step the command ran in, where a step is the command alone, or the gesture or batch it ran in. The step is put back before it is sent, so other tabs never get it as a change set, it leaves no undo step, and redo is kept. A cancelled gesture is put back the same way, and so is a step over a change set's limits (C39), with a notice. On a scratch store, a step the scratch server rejects was already sent, and only then does the command fault, so redo is cleared there. A command never runs inside a step the session did not open, where nothing could be put back.

Its limits are accepted:

- A batch that no longer reads faults as the batch, carrying its commands: they are read together.
- Numbers that overflow only in combination are a fault, put back, not a refusal.
- A gesture or batch inside an already open gesture has no step of its own: a refusal keeps its writes, and a fault cancels the open gesture.
- After a press of Undo in an open gesture, a fault puts back only what the gesture wrote since: the part the press ended was already a step.
