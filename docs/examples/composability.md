# Example - Composability

Plan Enforcer does not have to replace your planner.

## Shape

1. use your existing planner to generate the markdown plan
2. import or auto-detect that plan
3. execute under the Plan Enforcer ledger
4. verify closure from repo-local artifacts

## Commands

```bash
plan-enforcer import docs/plans/from-gsd.md
plan-enforcer review docs/plans/from-gsd.md
plan-enforcer status
```

Then run the plan in Claude Code.

## Result

Same enforcement layer.
Same awareness links.
Same chain of custody.
Same closure truth.
