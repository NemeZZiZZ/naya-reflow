# research

Raw working material behind [`docs/`](../docs/).

- [`captures/`](captures/) — intercepted NayaCore CDC sessions (`cdc-capture1.log`
  = full reference session with keymap reads; `capture3` = stock remap flash with
  per-key `30/1004` writes + `fe/100a` commits).
- [`dumps/`](dumps/) — `cdc-client.py` output: keymap baselines (`left-factory-*`),
  probe flashes, LED maps, 100b tables, aux sweeps (incl. dock/undock/swap series),
  HID report map notes. `left-factory-default-*.json` is the pristine reference.
- [`fcc/`](fcc/) — FCC filings `2BQ4V0825CRL/CRR/DG`: internal/external photos,
  full-res extractions, contact sheets (`CRL-view-*`, `CRR-view-*`), BLE/SRD/RF
  test reports, antenna specs, user manuals, label, RF exposure.
- [`ble/`](ble/) — `hid-report-map-left.bin` (212 B: kbd/consum/mouse reports).
