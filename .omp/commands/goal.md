# goal — the continuous driver

Loop: drive `nextgit-continue` repeatedly until one of:

- the queue has no `pending` rows,
- the user stops it,
- or a boundary rule fires: a `blocked` item needing a human decision; a heal budget exhausted; a gate red that is base-identical and unowned.

At every boundary: commit the state docs and report — what shipped, what is blocked, who owns it, and the exact next action.
