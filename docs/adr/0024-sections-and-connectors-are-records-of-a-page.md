# Sections and connectors are records of a page

A page holds two new kinds of record beside its frames: **sections** and **connectors**. Each is a record of its own in the design, synced as its own part, with its page as its holder, so deleting a page deletes them with it. A section is a title and an order. It has no position or size: its outline is drawn around its frames. A frame records the section it is in as a plain key (`sectionId`), so moving a frame in or out of a section changes one value of the frame and never its holder. A connector records its page and its two ends, each the id of a frame or a section on that page. Its path is worked out when it is drawn, from where its ends are, and is never stored. A frame's star is a key of the frame too (`starred`). None of them is ever drawn by an export, a thumbnail or a version picture: those draw frames only.

The references are loose. A frame whose `sectionId` names no section is in no section, and a section that no frame names is not drawn. A connector with an end that is gone is not drawn. The server's structure rules don't refuse any of these. The commands keep the design tidy: the command that empties a section deletes it, and a command that deletes a frame or a section deletes its connectors, each in the same step, so one undo brings everything back. Loose references are for the moments two people act at once. If one person moves a frame into a section while another deletes that section, nothing is refused and nothing is lost: the frame is simply in no section until an undo brings the section back.

Every new key is optional, and a stored design without sections or connectors reads them as none, so no stored design needs carrying over. `SCHEMA_VERSION` still rises to 22, so a tab built before can't drop the new keys it doesn't know.

## Considered Options

- **Sections and connectors as values of the page record** (a map of sections on the page): rejected. A page's map would be one synced value, so two people adding a section at once would lose one of them (ADR-0015: the later change wins).
- **A frame held by its section** (the section as the frame's holder, in place of its page): rejected. Moving a frame in or out of a section would change its holder, which the sync core treats as a move with an order among new siblings. A frame's page would also have to be found through its section.
- **Sections as a layer type, like a box, on the page**: rejected. Every layer is inside exactly one frame (ADR-0014), and the export, thumbnail and layer code all rest on that.
- **A stored path for a connector**: rejected. It would have to be rewritten whenever either end moved, as a second value two tabs could set differently, when the path follows from the ends.
- **Strict references refused by the server**: rejected. A change set from a tab that hadn't yet seen the other tab's delete would be refused whole, and the person's step would wait or be lost for a race they couldn't see.

## Consequences

- The sync core, the server's checks, the size limits, the undo history and the design's repair learn two new parts. A design holds at most 1,000 sections and 5,000 connectors, and the tab warns at 80%, as for layers.
- A loose reference can stay in a stored design: a frame naming a deleted section, or a hidden connector. Readers treat these as absent. A command that touches such a frame or connector may clear it.
- An agent reads sections and connectors through `read_design`, and makes and changes them with the same commands people use.
