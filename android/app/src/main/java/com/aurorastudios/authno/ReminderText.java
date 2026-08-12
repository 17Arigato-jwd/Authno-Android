package com.aurorastudios.authno;

/**
 * The words on a streak reminder, and the decision to send one at all.
 *
 * Split out of ReminderReceiver for the same reason ResumeText was split out
 * of ResumeWidgetProvider: it imports nothing from android, so it compiles and
 * RUNS off-device. The receiver around it is glue that only means anything on
 * a phone, but this is ordinary logic with ordinary edge cases — a stale
 * progress report, a goal already met, a streak of exactly one — and those are
 * worth pinning down rather than eyeballing.
 *
 * Tone matters here more than in most places. This arrives unasked on a lock
 * screen, so it says what is true and stops: no guilt, no exclamation marks,
 * no implication that a missed day undoes anything.
 */
final class ReminderText {

    private ReminderText() {}

    /**
     * Whether the reminder should fire at all.
     *
     * `metToday` is only believable if the app reported it TODAY. The receiver
     * runs with the app closed, possibly days after the last sync, so a stored
     * "goal met" from Tuesday must not silence Thursday's reminder — that is a
     * nudge silently disappearing, which reads as the feature being broken.
     *
     * @param skipWhenMet the writer's setting
     * @param metToday    what the app last reported
     * @param reportDay   the day that report was written, "yyyy-MM-dd"
     * @param today       the day the alarm actually fired
     */
    static boolean shouldNotify(boolean skipWhenMet, boolean metToday,
                                String reportDay, String today) {
        if (!skipWhenMet) return true;
        if (reportDay == null || today == null) return true;
        if (!reportDay.equals(today)) return true;   // stale — assume unmet
        return !metToday;
    }

    /** Short, and the same every day: this is a lock-screen line, not a headline. */
    static String title(int streakDays) {
        if (streakDays <= 0) return "Time to write";
        if (streakDays == 1) return "1 day so far";
        return streakDays + " days so far";
    }

    /**
     * The body.
     *
     * Names the goal because the number is the actionable part — "300 words"
     * is a decision the reader can make in the two seconds they are looking at
     * the notification, and "keep it going" is not.
     */
    static String body(int streakDays, int goalWords) {
        String goal = goalWords > 0 ? plural(goalWords, "word") : "a few words";
        if (streakDays <= 0) return "Your goal is " + goal + " today.";
        return "Write " + goal + " to keep the run going.";
    }

    static String plural(int n, String noun) {
        return group(n) + " " + noun + (n == 1 ? "" : "s");
    }

    /** 1,204 — String.format with a locale would group differently per device. */
    static String group(int n) {
        String s = Integer.toString(Math.abs(n));
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            if (i > 0 && (s.length() - i) % 3 == 0) out.append(',');
            out.append(s.charAt(i));
        }
        return (n < 0 ? "-" : "") + out;
    }
}
