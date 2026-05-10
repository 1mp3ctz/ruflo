# ruflo-aperture

Plugin wrapper for the [`aperture`](../../aperture/) Rust+WASM workspace. Logic lives in `aperture/`; this exists for IPFS distribution alongside `ruflo-market-data` / `ruflo-neural-trader`.

## Pane → Agent map

| Pane | Agent ID | Backed by |
|---|---|---|
| Quote | `aperture:pane.quote` | `aperture-data` `DataSource::quote()` |
| Chart | `aperture:pane.chart` | OHLCV + `ruflo-market-data` HNSW |
| Watchlist | `aperture:pane.watchlist` | `KeyValueStore` (sled / OPFS) |
| Oracle | `aperture:pane.oracle` | `ruflo-neural-trader` over bus |

## Verbs

| Verb | Owner | Reply |
|---|---|---|
| `DESC` | `pane.quote` | `QUOTE.RESULT` |
| `CHART [range]` | `pane.chart` | `CHART.RESULT` |
| `WATCH` / `UNWATCH` / `LIST` | `pane.watchlist` | — |
| `ASK "..."` | `pane.oracle` | `ASK.RESULT` |
| `FOCUS` | broadcast | — (re-anchor) |
| `QUOTE` / `OHLCV` | `agent.data` | `*.RESULT` |
