# MAHA event update checks

Preserve existing MAHA layout, authentication, admin role restrictions and Render hosting. Production push requires separate approval.

## Main flows
- Registration and sign-in: approved partner can enter; protected API refuses anonymous access.
- Admin: partner management, chat creation/referral request, event create/edit/list/attendees.
- Partner: home/events, referral, shop, team chat, community, video library.
- Notifications: existing event RSVP reminder and chat/reminder regression tests.

## Event change checks
- Legacy single-day event remains app registration; legacy calendar fallback remains one hour.
- Optional end date/time enables multi-day display and calendar span; invalid/earlier end rejected.
- Ongoing multi-day event remains visible until it ends.
- Generic Link accepts safe HTTP(S) links; invalid and script URLs rejected.
- Admin chooses app or external registration; external button opens supplied URL without recording an RSVP.
- Existing RSVPs preserved on mode changes but not advertised as external attendance.
- Admin uploads event files, sees uploaded filenames, removes an attachment from event, saves/reopens.
- Partner downloads attached files; anonymous/unlinked/non-event files protected.
- Upload failure keeps editor open; size/type/count limits; no real uploads in isolated QA.
- Mobile 375/320px editor scrolls with visible controls and no horizontal clipping.
- Browser critical event paths and navigation smoke checks; build/typecheck/regression suites.
- Hosted private preview checked after deployment; no real emails, orders or event registrations.

## Chat-first WhatsApp invitations
- Admin searches existing partners or creates an invitation without an account.
- Link contains only opaque invitation ID and secret, never contact/patient data.
- WhatsApp sharing prepares a message; the admin explicitly selects contact and sends.
- Invitation GET/scanner requests never consume the single-use entry link.
- Logged-in intended partner opens the new member chat directly.
- Guest chats first on one browser, without creating an account.
- No guest access to previous member chats, referrals, files or community.
- Temporary conversation can be kept through email-code verification and legal acceptance.
- New verified invitees are approved; existing eligible accounts reused, never duplicated.
- Decline, expiry and revocation disable guest access but retain the transcript for admins.
- Admin can link a retained conversation to a verified partner later, with explicit confirmation.
- Wrong account, replay, expired/incorrect codes, rate limits and failed email delivery handled.
- No physical Samsung/app-link association claim without a real device check.
