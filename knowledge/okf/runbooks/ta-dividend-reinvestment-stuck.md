---
type: Runbook
title: TA dividend reinvestment run stuck
description: Recover a transfer agency dividend reinvestment (DRIP) run that is stuck in PROCESSING.
resource: https://confluence.example.internal/display/TAOPS/RB-TA-017
tags: [transfer-agency, dividend, drip, stuck, ta-portal]
timestamp: 2026-08-22T11:05:00Z
namespace: transfer-agency/ta-portal
app_mnemonic: TAP
source: runbook
owner: Transfer Agency Production Support
runbook_id: RB-TA-017
---

# TA dividend reinvestment run stuck

## Symptoms
- TA Portal → Distributions shows a DRIP run in `PROCESSING` for more than 45 minutes.
- No new rows in the run's audit trail for 15 minutes.

## Steps
1. Check the distribution queue depth on the TA Ops dashboard. If above 50,000 messages, the run is slow, not stuck;
   wait 30 minutes.
2. If the queue is empty and the run is still `PROCESSING`, this matches [TA-882](/jira/TA-882.md).
3. Use **Distributions → Run actions → Resume from checkpoint**. Do not choose *Restart from beginning*; it
   creates duplicate reinvestment trades.
4. Confirm the run reaches `COMPLETED` and the reinvested share count matches the pre-run estimate.

## Escalation
- If resume fails, raise a P2 in project TA and contact the TA L3 on-call.
