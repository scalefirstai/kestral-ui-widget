---
type: ConfluencePage
title: TA Portal single sign-on FAQ
description: Common TA Portal login and SSO errors and how to resolve them.
resource: https://confluence.example.internal/display/TAOPS/TA+Portal+SSO+FAQ
tags: [sso, login, entra, ta-portal, access]
timestamp: 2026-05-19T16:45:00Z
namespace: transfer-agency/ta-portal
app_mnemonic: TAP
source: confluence
space: TAOPS
owner: TA Portal Engineering
---

# TA Portal single sign-on FAQ

**AADSTS50105 "user not assigned to a role"**: the user lacks the TA Portal entitlement. Request role
`TA-PORTAL-USER` in the access management tool; approval by the user's manager.

**Redirect loop after login**: clear cookies for the portal domain. If it persists, the user's browser blocks
third-party cookies for the IdP domain; add it to the allowed list via the desktop support team.

**"Session expired" every few minutes**: the user's clock is skewed. Sync the workstation time.
