---
type: Runbook
title: Re-run pricing for a single fund
description: Re-run the pricing load and valuation for one fund without re-running the whole overnight batch.
resource: https://confluence.example.internal/display/FAEAGLE/RB-PRC-004
tags: [pricing, rerun, single-fund, eagle-star]
timestamp: 2026-09-30T14:20:00Z
namespace: fund-accounting/eagle-star
app_mnemonic: ESR
source: runbook
owner: Pricing Operations
runbook_id: RB-PRC-004
---

# Re-run pricing for a single fund

Use when one fund has stale or missing prices after the overnight load, for example a late vendor file.

## Preconditions
- The fund is in status `PRICED_STALE` or `PRICE_MISSING` on the Pricing Exceptions screen.
- The vendor file for the fund's region has arrived (check the Vendor Files monitor).
- The fund's NAV has not been released. If it has, use the NAV restatement process instead.

## Steps
1. Open **Pricing → Single Fund Re-run**.
2. Enter the fund ID and valuation date. Leave *Source* as `DEFAULT` unless Pricing Ops says otherwise.
3. Click **Validate**. The screen lists securities that will be re-priced and any that breach tolerance.
4. If any breach tolerance, stop and follow [price tolerance checks FAQ](/confluence/price-tolerance-checks-faq.md).
5. Click **Submit re-run**. A job `ES_PRC_SINGLE_<fundId>` is created in AutoSys.
6. When it completes, re-run NAV for the fund from **NAV Dashboard → Recalculate fund** (four-eyes approval).

## Known issue
- Funds with more than 2,000 positions can time out on Validate. See [FUND-1511](/jira/FUND-1511.md).
