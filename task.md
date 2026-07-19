# Active Task: S-006M External Product Loop

- [x] Accept candidate `588bbe9` (four hosted CI jobs green after CI contract fix).
- [x] G-001 falsified epoch-1 private capability continuity.
- [x] Human authorized `G-AUTHORITY-001` one-way epoch-2 migration.
- [x] Execute `S001-SHIP-E2`: external epoch-2 key, pin public only, one receipt v2, epoch-2 canonical state, package `0.3.0`, freeze epoch-1 evidence.
- [ ] Execute `S-006M` in a **real non-Meta-Harness product repository** to merged and packaged state using installed `0.3.0`.
- [ ] Measure elapsed time, human interventions, and rework for S-006M.

Stop rule: no dual-epoch runtime, no vault/signer daemon/recovery framework, no new harness feature unless S-006M demonstrates a concrete blocker. Do not claim product proof until an external-repo change is merged and packaged.
