package com.fiath.videohub;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.util.Map;

/**
 * Schedules one alarm per (video, platform) reminder and keeps a copy in
 * SharedPreferences so reminders survive a reboot.
 */
final class ReminderScheduler {

    private static final String PREFS = "reminders";

    private ReminderScheduler() {
    }

    static void schedule(Context ctx, String id, long at, String title, String text) {
        if (at <= System.currentTimeMillis()) {
            cancel(ctx, id);
            return;
        }
        try {
            JSONObject o = new JSONObject();
            o.put("at", at);
            o.put("title", title);
            o.put("text", text);
            prefs(ctx).edit().putString(id, o.toString()).apply();
        } catch (Exception ignored) {
        }
        setAlarm(ctx, id, at, title, text);
    }

    static void cancel(Context ctx, String id) {
        prefs(ctx).edit().remove(id).apply();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pendingIntent(ctx, id, null, null));
    }

    static void remove(Context ctx, String id) {
        prefs(ctx).edit().remove(id).apply();
    }

    /** Re-creates every stored future alarm (after reboot / app update). */
    static void restoreAll(Context ctx) {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, ?> e : prefs(ctx).getAll().entrySet()) {
            try {
                JSONObject o = new JSONObject(String.valueOf(e.getValue()));
                long at = o.getLong("at");
                if (at > now) {
                    setAlarm(ctx, e.getKey(), at, o.optString("title"), o.optString("text"));
                } else {
                    remove(ctx, e.getKey());
                }
            } catch (Exception ignored) {
            }
        }
    }

    private static void setAlarm(Context ctx, String id, long at, String title, String text) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = pendingIntent(ctx, id, title, text);
        boolean exactAllowed = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exactAllowed) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException se) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    private static PendingIntent pendingIntent(Context ctx, String id, String title, String text) {
        Intent i = new Intent(ctx, ReminderReceiver.class);
        i.setData(Uri.parse("videohub://reminder/" + Uri.encode(id)));
        i.putExtra("id", id);
        if (title != null) i.putExtra("title", title);
        if (text != null) i.putExtra("text", text);
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
