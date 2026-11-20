# Bindings sync one by one, and an edit ends one inside its command

This extends ADR-0015's values and ADR-0004's commands for bindings. The full rules are in the bindings spec (#33).

A layer's bindings stay where the design keeps them, beside its props, keyed by bindable property. Each binding is a value of its own, as each key of `props` is: a change sets or takes out one binding, and where two tabs set one binding, the change the server orders later wins. So two tabs binding two properties of one layer both keep theirs, and a hand edit in one tab never takes out a binding another tab made on another property. The stored shape doesn't change, so stored designs need no carry-over, and the server still takes a change that sets a layer's bindings whole, as journals and saved tab queues written before hold.

Editing a bound property by hand ends its binding inside the same command: after a command writes, each binding whose value it changed comes off, in the same step, so one undo brings back both and every tab and every caller (the editor, the assistant, agents) gets the same result. Commands that set bindings themselves (binding, setting a style, restoring a version) say so and are left alone. A bound value is compared by the property's own value, so an edit that leaves it as it was keeps the binding, as FigCraft does.

## Considered Options

- **Keep a layer's bindings one value**: rejected. Two tabs binding the font and the colour of one text lose one, and a hand edit that ends one binding writes back the others as the tab last saw them.
- **Keep each binding inside the value it binds** (on the paint, in the text's style), so the two always win together: rejected. Every stored design, journal and saved queue would need a carry-over, and a property held as a bare number has nowhere to keep one.
- **Send a property and its bindings together in every change set**, so the later step wins both: rejected. Changing a text's letter spacing in one tab would then take out a colour binding another tab made at the same time.
- **Ending the binding in the editor before the edit, as a second command**: rejected. Callers other than the editor's panels (the assistant, agents, Paste style) would each have to remember it.

## Consequences

When one tab edits a text's colour by hand while another binds its font, and the server orders the binding later, the text's style is the binding tab's (the style is one value), so the hand-picked colour is lost while its binding stays ended: the text shows the colour it kept. This is the cost ADR-0015 already accepts for two edits of one value.
