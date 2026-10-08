# Changelog

## 0.3.2

- Jev picks agents again: the topic tags no longer sit inside the agent catalog, where Jev took a tag for the answer and the pane fell back to `by words`. Jev answers cached before this version are not read, so queries seen before pick by Jev too.

## 0.3.1

- `busyRows` and the pane header text live in `hooks/rows.ts`; no change in behaviour.

## 0.3.0

- From the next mode, `↻` and `/crew refresh` turn the crew back to the current conversation instead of picking again for the same guess. The queue stays, and the queued agents still start with your next prompt.

## 0.2.0

- `↻` at the right of the CREW header and `/crew refresh` pick the crew again for the current conversation: your last prompt plus the end of Claude's last reply. They skip the jev and task caches and write the fresh answers back.
- Rows you are working with (a draft, `writing`, `started`, `queued`) stay on top through a refresh; new picks fill the free places, 5 rows at most. In the next mode the refresh keeps the guess and the queue.
- A pane opened with `/crew` before any prompt shows the header with `↻` instead of nothing.

## 0.1.0

Moved out of flightdeck 0.6.1. What differs from the CREW panel there:

- Own pane `Crew`. It opens with the first suggestion for a prompt (option `autoOpen`), not at session start, so an empty Crew takes no room.
- Options `crewRun` and `palette` live in this plugin now: values set for flightdeck do not carry over, set them again.
- A failed queued start shows as a toast `crew · …` instead of a line in flightdeck's session log.
- Saved tags and tasks start empty: state moved to the `crew` namespace.
- `/crew [open|close|reset]` reopens, closes or clears the pane; `/flightdeck reset` no longer touches Crew.
