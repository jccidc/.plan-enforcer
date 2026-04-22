# Example - Resume continuity

Use this when a session is interrupted or handed off.

## During the run

- the ledger tracks task state on disk
- decisions are typed in the Decision Log
- status and logs remain queryable between sessions

## After interruption

Run:

```bash
plan-enforcer status
plan-enforcer logs
plan-enforcer report --active
```

This gives the next operator:

- current task
- unfinished rows
- drift / deviation history
- awareness gaps
- executed-check state

Resume continuity is not an afterthought. It is part of the runtime.
