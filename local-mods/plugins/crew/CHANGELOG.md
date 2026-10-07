# Changelog

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
