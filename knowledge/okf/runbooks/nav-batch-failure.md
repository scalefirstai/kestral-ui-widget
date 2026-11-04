---
type: Runbook
title: NAV overnight batch failure (Eagle STAR)
description: How to triage and restart the Eagle STAR overnight NAV calculation batch when it fails or overruns.
resource: https://confluence.example.internal/display/FAEAGLE/RB-NAV-001
tags: [nav, batch, eagle-star, restart, autosys]
timestamp: 2026-10-14T09:00:00Z
namespace: fund-accounting/eagle-star
app_mnemonic: ESR
source: runbook
owner: Fund Accounting Production Support
runbook_id: RB-NAV-001
---

# NAV overnight batch failure (Eagle STAR)

The NAV batch (`ES_NAV_MAIN`) runs nightly at 22:30 ET after the pricing load. It must complete before 05:00 ET so
NAVs can be released to transfer agency. See [overnight batch architecture](/confluence/eagle-star-overnight-batch-architecture.md).

## Symptoms
- AutoSys shows `ES_NAV_MAIN` in `FAILURE` or `RUNNING` past 03:00 ET.
- NAV Dashboard shows funds in status `PENDING_CALC` after 03:00 ET.
- Alert `EAGLE-NAV-SLA` in the support channel.

## Triage
1. In AutoSys, check the failed sub-job: `ES_NAV_PRICE_CHECK`, `ES_NAV_ACCRUALS` or `ES_NAV_CALC`.
2. If `ES_NAV_PRICE_CHECK` failed with `PRICE_TOLERANCE_BREACH`, do **not** restart. Follow
   [price tolerance checks FAQ](/confluence/price-tolerance-checks-faq.md) and get pricing team sign-off first.
3. If `ES_NAV_ACCRUALS` failed with `ORA-00060` (deadlock), this is known issue [FUND-1423](/jira/FUND-1423.md);
   restart is safe.
4. If `ES_NAV_CALC` failed with `OutOfMemoryError`, check fund count in the run. Over 4,000 funds needs the
   large-run profile (see step 3 of Restart).

## Restart
1. Confirm no other NAV job is running: `autorep -J ES_NAV% -q`.
2. Restart only the failed sub-job: `sendevent -E FORCE_STARTJOB -J <failed sub-job>`.
3. For memory failures, set `ES_NAV_PROFILE=LARGE` on the job before restart (requires L2 approval).
4. Monitor on NAV Dashboard. Funds move `PENDING_CALC` → `CALCULATED` → `RELEASED`.

## Escalation
- Fails twice: raise a JIRA in project FUND with priority P2 and page the Eagle STAR L3 on-call.
- Past 04:30 ET: notify the Transfer Agency duty manager that NAV release will be late.

Never update NAV or price values directly in the database. All corrections go through the NAV Override screen with
four-eyes approval.
