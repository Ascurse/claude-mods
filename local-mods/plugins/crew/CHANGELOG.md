# Changelog

## 0.1.0

Moved out of flightdeck 0.6.1. What differs from the CREW panel there:

- Own pane `Crew`. It opens with the first suggestion for a prompt (option `autoOpen`), not at session start, so an empty Crew takes no room.
- Options `crewRun` and `palette` live in this plugin now: values set for flightdeck do not carry over, set them again.
- A failed queued start shows as a toast `crew · …` instead of a line in flightdeck's session log.
- Saved tags and tasks start empty: state moved to the `crew` namespace.
- `/crew [open|close|reset]` reopens, closes or clears the pane; `/flightdeck reset` no longer touches Crew.
