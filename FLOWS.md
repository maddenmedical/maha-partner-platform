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

## Rich temporary chat
- Baseline inspected in synthetic mobile browser: temporary chat only had text and Keep this chat.
- Guest and admin use the shared chat composer and message bubbles, preserving MAHA styling.
- Send text, emoji, photo, document, audio/video and recorded voice note; preview/remove pending attachment.
- Reply and swipe to reply; original sender/snippet visible; cross-invitation reply IDs rejected.
- React/unreact and star/unstar; search current conversation and show starred messages only.
- Admin edits own messages and soft-deletes with in-page confirmation; guest cannot edit/delete or access admin actions.
- Timestamps, safe clickable web links, download attachments, mobile message action sheet.
- Failed sends retain text/attachment/reply; retries use same request ID without duplicate messages.
- Files restricted to this invitation, private previews restricted to uploader, closed guest access denied.
- Reject spoofed/foreign attachments and unsafe files; enforce 20 MB/file, 25 files and 100 MB/invitation.
- On account linking: preserve files, replies, reactions, stars, edits/deletions and guest attribution atomically.
- Decline/revoke/expiry retains admin transcript and attachments without allowing guest access.
- No guest access to partner directory, other chats, referrals, community, admin to-dos or MP3 conversion.
- Browser desktop/mobile/narrow guest and admin paths, normal member chat regression, existing flow smoke.
- Private synthetic preview only; Render production push requires new approval.

## Invitation account guidance
- Existing non-partner email explains that this is a partner-chat linking flow; open the existing account in a separate tab without promising chat transfer.
- Pending/inactive partner explains that the existing account needs review in this conversation, without creating a duplicate or changing approval.
- Wrong invited email offers correction; verification limit explains requesting a new invitation within the current chat.
- Guidance appears next to verification controls; changing email or returning to chat clears stale errors.
- Continue chatting preserves messages, composer draft and guest access; account sign-in opens separately.
- Approved and new partners still verify and keep rich conversations; failed guidance requests do not send email or mutate accounts.
- Desktop, 375px/320px, hosted preview and existing navigation regression; no production push without approval.
