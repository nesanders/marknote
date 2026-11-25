# To-do blocks

A to-do block is a checklist with its own Done section. Ticking an item moves it
into Done (collapsed by default) and stamps the day it was completed. A note can
hold any number of to-do blocks. The format is plain Markdown plus one HTML
comment, so it reads well in any editor and on GitHub, and the desktop app and
the web app share it exactly.

```markdown
<!-- marknote-todo -->
- [ ] Book flights
- [ ] Renew passport 📅 2026-12-01

<details>
<summary>Done (2)</summary>

- [x] Pack charger ✅ 2026-11-25
- [x] Buy adapter 📅 2026-11-20 ✅ 2026-11-24

</details>
```

## Structure

1. **Marker**: a line that is exactly `<!-- marknote-todo -->`, optionally with
   options: `<!-- marknote-todo sort=due -->`. Unknown options are kept.
2. **Open list**: the task list that follows (blank lines between are allowed).
   It may be empty.
3. **Done section** (optional, written once anything is done): `<details>`,
   `<summary>Done (n)</summary>`, a blank line, the done task list, a blank
   line, `</details>`. The count is rewritten on every change.

The block ends after `</details>`, or after the open list when there is no Done
section. Anything else ends the block early; what was read so far is still a
valid block.

An **item** is a task line (`- [ ]`, `- [x]`, also `*`/`+` bullets) plus any
following indented lines (notes, sub-items), which travel with it.

## Dates

Dates use the [Obsidian Tasks](https://publish.obsidian.md/tasks/) emoji form so
other tools understand them:

- `📅 YYYY-MM-DD`: due date, optional, on open or done items. Kept on completion.
- `✅ YYYY-MM-DD`: completion date, on every done item.

They are written at the end of the item's first line, due first, then done.

## Operations

- **Check** an open item: it moves to the **top** of Done and gets `✅ today`
  (replacing any earlier one).
- **Uncheck** a done item: it moves to the **bottom** of the open list and
  loses `✅`.
- **Set/clear due date**: on any item.
- **Sort**: `manual` (default; the order in the file is the order you see) or
  `due` (`sort=due` in the marker): open items are kept sorted by due date,
  earliest first, undated last, ties in their existing order. The file is
  rewritten in that order.
- **Normalise** (after every operation): checked items in the open list move to
  Done, unchecked items in Done move to the open list, the count is updated, and
  an empty Done section is removed.

`test/fixtures/todo.json` holds shared cases (input, operation, expected
output) run by both the web and desktop tests.
