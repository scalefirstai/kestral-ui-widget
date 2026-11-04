---
type: ConfluencePage
title: Eagle STAR overnight batch architecture
description: Order, dependencies and SLAs of the Eagle STAR overnight batch chain from pricing load to NAV release.
resource: https://confluence.example.internal/display/FAEAGLE/Overnight+Batch+Architecture
tags: [architecture, batch, nav, pricing, sla, eagle-star]
timestamp: 2026-07-11T10:00:00Z
namespace: fund-accounting/eagle-star
app_mnemonic: ESR
source: confluence
space: FAEAGLE
owner: Eagle STAR Engineering
---

# Eagle STAR overnight batch architecture

| Order | Job | Starts (ET) | Depends on | SLA |
| --- | --- | --- | --- | --- |
| 1 | `ES_PRC_LOAD` vendor price load | 21:00 | Vendor files | 22:15 |
| 2 | `ES_PRC_VALIDATE` tolerance checks | 22:15 | 1 | 22:30 |
| 3 | `ES_NAV_MAIN` NAV calculation | 22:30 | 2 | 03:00 |
| 4 | `ES_NAV_RELEASE` publish to TA | 03:00 | 3 + sign-off | 05:00 |

`ES_NAV_MAIN` has three sub-jobs: `ES_NAV_PRICE_CHECK`, `ES_NAV_ACCRUALS`, `ES_NAV_CALC`.
Sub-jobs are restartable individually; the chain resumes from the restarted job.

Failure handling: [NAV overnight batch failure runbook](/runbooks/nav-batch-failure.md).
