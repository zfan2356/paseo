# Session context migration rehearsal

Snapshot: 2026-11-13T14:12:05.377Z. Code: WORK-366 SessionContextStore; the final integration includes target main `e3aeab4c4`. This rehearsal reads migration fields from the local production home and runs `SessionContextStore` against an isolated task-owned home. It starts no daemon and does not write production files.

The private snapshot contains only agent IDs, cwd, workspace membership, archive/internal flags, parent labels, workspace pin/label values and project IDs. Credentials, transcripts, prompts and titles were not copied. The report contains aggregate counts and opaque project IDs. Capture was a live read of files, not a quiesced filesystem snapshot.

| Check                                                | Result                |
| ---------------------------------------------------- | --------------------- |
| Agent records / unique agents                        | 726 / 726             |
| Contexts initialized                                 | 726                   |
| Visible root sessions                                | 27                    |
| Pinned visible roots                                 | 9                     |
| Labeled visible roots                                | 0                     |
| Workspaces with multiple visible roots               | 3 (6 sessions, max 2) |
| Invalid / duplicate records                          | 0 / 0                 |
| Missing workspace references                         | 0                     |
| Migration value mismatches                           | 0                     |
| Concurrent re-read preserves changed project and pin | true                  |

Every context's initial project, lexical startup directory and inherited pin/label values matched the copied inputs. All 726 records, including archived/internal sessions, received their workspace project; only visible roots received sidebar pins and labels. The three multi-session workspaces each expanded into two independent root contexts. The production sample has no labeled visible roots, so nonempty label inheritance and rename/delete recovery are demonstrated by isolated automated tests rather than this sample.

Project counts include archived and internal sessions (726 total):

| Project ID             | Sessions |
| ---------------------- | -------: |
| `prj_09bbf56dbcc2e7d8` |        1 |
| `prj_0b0e087ae6ee7e70` |        1 |
| `prj_12768c8590ca90b4` |        1 |
| `prj_136d3933efe41338` |        2 |
| `prj_15b74de4cdc79764` |        1 |
| `prj_1e7ecba2e252db32` |        1 |
| `prj_237bbdd041190f23` |        1 |
| `prj_26be9af24f8d381f` |        2 |
| `prj_2ed08bcc63c909d8` |       19 |
| `prj_337b1cfeeb7e92a0` |        1 |
| `prj_349746049bd52d10` |        1 |
| `prj_34c6b09f674606b0` |      144 |
| `prj_38250322748122ee` |        3 |
| `prj_3a2a9c16a4c35dab` |        1 |
| `prj_442b51c85a1df4be` |        1 |
| `prj_4826fabe202c022d` |        2 |
| `prj_496101c95af9665b` |        1 |
| `prj_4ac364bb8bb24455` |        1 |
| `prj_4bab4d0f28f393c8` |       51 |
| `prj_4cf54d9342dd17f1` |        2 |
| `prj_50958036b29b7f8b` |        1 |
| `prj_6d93f3eff9327d18` |        1 |
| `prj_7231c6d073144edb` |        1 |
| `prj_72ab018871aed4cd` |        1 |
| `prj_84ce46411ad9c4d5` |        1 |
| `prj_8db0a61f2ffe59e8` |        1 |
| `prj_8dbbeea5f59d0d1d` |        1 |
| `prj_9184321b0c40302d` |        1 |
| `prj_937df175a1fd051c` |        1 |
| `prj_94c911ac56cc4ae6` |      209 |
| `prj_9b6fa7dd83319b75` |        2 |
| `prj_9c506099e7e6b69d` |        1 |
| `prj_9ffd0c7cbc274ac3` |        1 |
| `prj_a3f13071fcc201c2` |        1 |
| `prj_b2f22230492ae8cb` |      251 |
| `prj_b74433bdab088b4d` |        3 |
| `prj_b819f1c67c6f50cf` |        1 |
| `prj_c0f898ee1bc3d564` |        1 |
| `prj_c56fec3b7933f1e5` |        1 |
| `prj_c8ba6f11d15de029` |        1 |
| `prj_ce622f7e919d298f` |        1 |
| `prj_d0530e57ad95b899` |        1 |
| `prj_d086b5cc832afa88` |        1 |
| `prj_d412b2b544faa4e6` |        1 |
| `prj_dff0e4a2c29d39bb` |        1 |
| `prj_e6398693ad7c2528` |        1 |
| `prj_e86860a77aef5360` |        1 |
| `prj_ef40e19500c73a34` |        1 |

The snapshot includes 48 distinct project references although the active project registry had 38 records. Historical project references are retained for repair rather than silently reassigned. No project-existence check is applied during initialization; manual reassignment validates an active target.

Reproduction: copy only the listed migration fields into a private task directory; build the server stack; construct `SessionContextStore` with readers over that snapshot and a fresh output directory; initialize every agent, compare all seeded fields, then change one session's project/pin and issue concurrent reads. Do not publish the private snapshot. The unit suite covers malformed/inaccessible files and nonempty legacy labels; daemon E2E covers the unchanged legacy agent writer and subsequent restart.
