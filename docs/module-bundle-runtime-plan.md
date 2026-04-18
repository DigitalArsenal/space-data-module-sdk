# Superseded: Single-File Module Bundle Runtime Plan

This document is superseded by:

- [module-publication-standard.md](/Users/tj/software/OrbPro/packages/space-data-module-sdk/docs/module-publication-standard.md)
- [isomorphic-sdn-runtime-plan.md](/Users/tj/software/OrbPro/packages/space-data-module-sdk/docs/isomorphic-sdn-runtime-plan.md)

The old document is no longer current because:

- the canonical publication model now explicitly allows appended `REC` records carrying `PNM` and `ENC`
- the canonical runtime discussion has moved to the SDK runtime host model
- bundle/container concerns and runtime-host concerns are now documented separately

Current rule summary:

- the executable artifact is still canonical `.wasm`
- single-file bundle metadata is carried by an `MBL` record inside one appended `REC` trailer
- publication/signature/encryption metadata is carried in that same appended `REC` trailer when present
- runtime hosting is defined by the SDK runtime host, not by the bundle container itself
