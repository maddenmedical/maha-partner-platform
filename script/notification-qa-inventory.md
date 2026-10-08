# Notification QA inventory

This change is tested against synthetic accounts and an in-memory database. All outgoing email and push are intercepted, never sent to real recipients.

| Requirement / visible control | Check | Evidence |
| --- | --- | --- |
| Unread count on app icon | WorkerNavigator and foreground navigator get absolute ledger count for preview, alert and quiet, including zero | Mocked API checks and browser badge spy; physical OS badge remains live-device acceptance |
| Bell count and unread list | Count survives app opening; open bell, open ordinary item, bulk read, close | Browser desktop and 320/375/430 phone widths |
| Visible referral priority | Red banner and highlighted inbox card; remains until detail opens; opens correct referral | Browser click-through and synthetic submitted referral |
| Personal review state | Admin A review leaves Admin B unread; generic bulk action cannot dismiss referral | API regression checks |
| Reliable referral email | Shared mailbox accepts while one admin fails; only failure retries; provider idempotency headers; stable priority and authenticated link | Mock provider regression checks |
| Patient privacy | Referral mail/push contains reference number, not patient name/contact/case | Assertions on mock outbound payload |
| Disabled notifications/no subscription | Preferences honored for ordinary alerts; in-app ledger works without push | Regression checks |
| Archived/deleted referrals | Remove stale critical alerts; deleted outbox removed | Regression checks |
| Router behavior | Same-page click, cold email-style URL and hash routing | Browser checks |
| Fault recovery | Fetch failure/offline, inbox retry; referral submission not rolled back by provider error | Mocked worker, API and browser checks |
| Responsive layout | Header/bell/banner/dialog bounds; light/dark; phone and desktop | Chromium, Firefox, WebKit screenshots and bounds |
| Production boundaries | No production mutation; no live provider sends; commit/push require approval | Git status and fixture-only execution |
| Two-hour chat reminder | Unopened and read-but-unanswered partner/admin private chats; one per waiting episode; no sender reminders; any admin reply closes the team's waiting episode | 17 deterministic clock/provider tests |
| Reminder navigation | Email link opens its specific private chat for the correct signed-in role | Chromium, Firefox and WebKit, partner and admin |
| Chat read acknowledgement | Opening messages clears only that user's matching app-notification rows | API isolation and delete cleanup tests |

Exploratory cases include referral links while already on the referral page, zero unread alerts, a failed inbox fetch, and a narrow iPhone-style header with the install button visible.
