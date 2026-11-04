---
type: ConfluencePage
title: Price tolerance checks FAQ
description: What price tolerance breaches mean, who approves overrides and why NAV must not be restarted until they are resolved.
resource: https://confluence.example.internal/display/FAEAGLE/Price+Tolerance+FAQ
tags: [pricing, tolerance, faq, approval, eagle-star]
timestamp: 2026-06-03T08:30:00Z
namespace: fund-accounting/eagle-star
app_mnemonic: ESR
source: confluence
space: FAEAGLE
owner: Pricing Operations
---

# Price tolerance checks FAQ

**What is a tolerance breach?** A security's price moved more than its tolerance band since the previous valuation
(default 5% for equities, 2% for fixed income, 0.5% for money market).

**Can support override a breach?** No. Only Pricing Operations can accept a price or supply a manual price, through
the Price Challenge screen with four-eyes approval.

**Why can't I just restart NAV?** NAV will fail again at `ES_NAV_PRICE_CHECK`, or worse, calculate on an unapproved
price. Wait for Pricing Ops to clear every breach on the Pricing Exceptions screen.

**Who do I contact?** Pricing Operations duty desk, or raise a P2 in project PRC if after hours.
