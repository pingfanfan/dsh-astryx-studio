# Lint calibration

@astryxdesign/cli 0.7.11, 57 page templates, written with `template()` exactly as `astryx_template` writes them. Regenerate: `CALIBRATION_WRITE=1 pnpm vitest run tests/calibration.test.ts`.

| Check | False positives |
|---|---|
| esbuild syntax on the template | 0 |
| import whitelist on the template (as a new file) | 0 |
| count-diff, no-op rewrite | 0 |
| count-diff + syntax, copy edit (first string literal gets Chinese text) | 0 |

Changes made during calibration:

- `recharts` added to the import whitelist (the dashboard/chart templates import it directly, 9 imports).
- Import detection switched from a regex to esbuild parsing: `table-tree` carries a code sample in a string (`await import('canvas-editor')`) that the regex counted as an import (1 false positive before the fix).

Why the rule is a count-diff and not a ban (absolute counts in the original templates):

- `<div>`: 32 occurrences in 12 templates
- `style={{}}`: 16 in 7 templates
- `stylex.create`: 27 in 15 templates

| Template | Lines | `<div>` | `style={{}}` | `stylex.create` |
|---|---|---|---|---|
| ai-chat | 764 | 0 | 0 | 0 |
| ai-chat-landing | 470 | 0 | 0 | 0 |
| dashboard | 804 | 0 | 3 | 0 |
| login | 98 | 0 | 0 | 0 |
| blank | 19 | 0 | 0 | 0 |
| canvas-editor | 2876 | 2 | 0 | 6 |
| library | 514 | 1 | 0 | 0 |
| centered-hero | 78 | 0 | 0 | 0 |
| payment-form | 979 | 0 | 0 | 0 |
| checkout-wizard | 1152 | 0 | 0 | 0 |
| classic-gallery | 162 | 1 | 0 | 0 |
| table-collapsible | 1475 | 0 | 0 | 1 |
| table-comparison | 1459 | 0 | 0 | 1 |
| contact-form | 293 | 0 | 0 | 0 |
| dashboard-comparison | 895 | 1 | 0 | 2 |
| form-wizard-dialog | 588 | 0 | 0 | 0 |
| documentation | 273 | 0 | 0 | 0 |
| documentation-design | 758 | 0 | 0 | 0 |
| documentation-technical | 257 | 0 | 0 | 0 |
| dashboard-scorecard | 875 | 0 | 0 | 2 |
| file-explorer | 539 | 0 | 2 | 0 |
| table-filter | 4632 | 0 | 0 | 3 |
| form-wizard | 841 | 0 | 0 | 0 |
| dashboard-cohort-funnel | 915 | 0 | 0 | 1 |
| gallery-hero | 95 | 0 | 0 | 0 |
| table-grouped | 1219 | 0 | 0 | 0 |
| ide | 464 | 1 | 2 | 0 |
| table-inbox | 2705 | 0 | 0 | 1 |
| incident-console | 581 | 0 | 0 | 0 |
| form-wizard-inline | 936 | 0 | 1 | 0 |
| kanban-board | 754 | 0 | 0 | 1 |
| login-card | 214 | 0 | 0 | 0 |
| login-split | 275 | 2 | 0 | 0 |
| login-sso | 285 | 0 | 0 | 0 |
| messaging-shell | 675 | 6 | 1 | 0 |
| mixed-gallery | 169 | 1 | 0 | 0 |
| detail-page | 627 | 0 | 0 | 0 |
| editor | 957 | 0 | 1 | 0 |
| dashboard-composition | 768 | 0 | 0 | 0 |
| product-detail | 299 | 0 | 0 | 0 |
| product-gallery | 160 | 0 | 0 | 0 |
| dashboard-progress | 1140 | 1 | 0 | 1 |
| table-page | 993 | 1 | 0 | 0 |
| dashboard-alert-rail | 1591 | 2 | 0 | 2 |
| settings-dialog | 2604 | 0 | 0 | 3 |
| settings | 231 | 0 | 0 | 0 |
| settings-sidebar | 835 | 0 | 0 | 0 |
| shell-nav | 322 | 0 | 0 | 0 |
| side-gallery | 143 | 0 | 0 | 0 |
| shell-side-nav | 242 | 0 | 0 | 0 |
| table | 86 | 0 | 0 | 0 |
| theme-showcase | 1293 | 13 | 6 | 0 |
| shell-top-nav | 225 | 0 | 0 | 1 |
| table-tree | 1705 | 0 | 0 | 1 |
| form-two-column | 241 | 0 | 0 | 0 |
| form-wizard-vertical | 1382 | 0 | 0 | 0 |
| work-item-detail | 902 | 0 | 0 | 1 |
