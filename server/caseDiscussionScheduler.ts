import type { IStorage } from "./storage";
import { sendToSubscriptions } from "./push";

// Guard against duplicate intervals (e.g. tsx hot reload in dev). Clearing any
// existing interval before creating a new one keeps exactly one running.
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Lightweight in-process scheduler: once a case discussion's start time passes,
// fire a single push notification (with the Zoom link) to every partner who
// RSVP'd, then mark it notified so it never double-sends.
export function startCaseDiscussionScheduler(storage: IStorage) {
  const CHECK_INTERVAL_MS = 60_000; // every minute
  const WINDOW_MS = 5 * 60_000; // catch anything that started in the last 5 minutes, in case the interval was delayed

  if (intervalHandle) clearInterval(intervalHandle);

  intervalHandle = setInterval(async () => {
    try {
      const now = Date.now();
      const due = await storage.findCaseDiscussionsNeedingNotification(now - WINDOW_MS, now);
      for (const discussion of due) {
        const attendees = await storage.listCaseDiscussionAttendees(discussion.id);
        if (attendees.length > 0) {
          const subs = await storage.getPushSubscriptionsForUserIds(attendees.map((a) => a.userId));
          const result = await sendToSubscriptions(subs, {
            title: "Event starting now",
            body: `${discussion.topic} is starting — tap to join on Zoom.`,
            url: discussion.zoomLink,
          });
          // Prune expired/unsubscribed endpoints, same as the announcements route.
          if (result.removedEndpoints.length) {
            await storage.deletePushSubscriptionsByEndpoints(result.removedEndpoints);
          }
        }
        await storage.markCaseDiscussionNotified(discussion.id, now);
      }
    } catch (err) {
      console.error("[case-discussion-scheduler] error:", err);
    }
  }, CHECK_INTERVAL_MS);
}
