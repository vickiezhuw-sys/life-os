# Migration Record

## Source state

- Existing product: Life OS Weekly Planner
- Source artifact: `Life OS · 本周计划.txt`
- Original source repository: unavailable
- Original local machine: no longer available
- Site projection: still available
- GitHub destination: `vickiezhuw-sys/life-os`

## Recovery boundary

The original source code could not be exported from the Site projection.
This project therefore treats the published v1 product as the behavioral specification.

## Baseline acceptance criteria

1. Five Life OS modules are present.
2. Weekly progress is calculated from task completion.
3. 16 baseline tasks for 2026-09-09 through 2026-09-13 are seeded.
4. Task completion state persists in the browser.
5. Tasks can be added, edited, and deleted.
6. Week navigation exists.
7. Existing product wording is preserved where it was recoverable.
8. Build is NOT mixed into the baseline recovery commit.

## Next phase

Build:
- content
- date
- time
- fast capture
- persistent records
- daily / weekly / monthly / yearly statistics
