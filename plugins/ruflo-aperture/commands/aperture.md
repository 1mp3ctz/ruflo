---
name: aperture
description: Open Aperture market workspace. Form `/aperture [SYMBOL VERB [ARG...] [GO]]`.
---

Examples:
- `/aperture` — empty workspace
- `/aperture AAPL DESC GO` — Quote pane on AAPL
- `/aperture BTC CRYPTO` — crypto quote
- `/aperture ASK "what moved NVDA today"` — Oracle pane

Native: `cargo run -p aperture-tui`. Browser: `pnpm --filter ruvocal dev` → `/aperture`.
