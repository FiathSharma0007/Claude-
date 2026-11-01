package com.fiath.videohub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Uploads videos to YouTube in the foreground (resumable upload, 8 MB chunks),
 * then sets the custom thumbnail. Job state is kept in SharedPreferences so the
 * app can show it again after being reopened.
 */
public class YouTubeUploadService extends Service {

    interface Listener {
        void onJob(String json);
    }

    static volatile Listener listener;

    private static final String CHANNEL = "youtube_uploads";
    private static final int NOTIF_ID = 4242;
    private static final int CHUNK = 8 * 1024 * 1024; // multiple of 256 KB

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger pending = new AtomicInteger();
    private PowerManager.WakeLock wakeLock;

    static void enqueue(Context c, String jobJson) {
        try {
            JSONObject j = new JSONObject(jobJson);
            publish(c, j.getString("appId"), "queued", 0, "", "");
        } catch (Exception ignored) {
        }
        Intent i = new Intent(c, YouTubeUploadService.class).putExtra("job", jobJson);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static SharedPreferences jobs(Context c) {
        return c.getSharedPreferences("youtube_jobs", Context.MODE_PRIVATE);
    }

    static String allJobs(Context c) {
        JSONObject o = new JSONObject();
        for (java.util.Map.Entry<String, ?> e : jobs(c).getAll().entrySet()) {
            try {
                o.put(e.getKey(), new JSONObject(String.valueOf(e.getValue())));
            } catch (Exception ignored) {
            }
        }
        return o.toString();
    }

    static void clearJob(Context c, String appId) {
        jobs(c).edit().remove(appId).apply();
    }

    private static void publish(Context c, String appId, String state, int pct, String msg, String ytId) {
        try {
            JSONObject o = new JSONObject();
            o.put("appId", appId);
            o.put("state", state);
            o.put("pct", pct);
            o.put("msg", msg == null ? "" : msg);
            o.put("youtubeId", ytId == null ? "" : ytId);
            String s = o.toString();
            jobs(c).edit().putString(appId, s).apply();
            Listener l = listener;
            if (l != null) l.onJob(s);
        } catch (Exception ignored) {
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startInForeground("Preparing upload…", 0, true);
        final String job = intent == null ? null : intent.getStringExtra("job");
        if (job == null) {
            if (pending.get() == 0) stopSelf();
            return START_NOT_STICKY;
        }
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FaithFinance:upload");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(6 * 60 * 60 * 1000L);
        }
        pending.incrementAndGet();
        worker.execute(() -> {
            try {
                runJob(new JSONObject(job));
            } catch (Exception ignored) {
            } finally {
                if (pending.decrementAndGet() == 0) {
                    if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
                    stopForeground(true);
                    stopSelf();
                }
            }
        });
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        worker.shutdownNow();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    private void runJob(JSONObject j) {
        String appId = j.optString("appId");
        String title = j.optString("title");
        try {
            File video = new File(j.getString("path"));
            if (!video.exists()) throw new Exception("Video file not found");

            JSONObject snippet = new JSONObject();
            snippet.put("title", clean(title, 100).isEmpty() ? "Untitled" : clean(title, 100));
            snippet.put("description", clean(j.optString("description"), 4900));
            snippet.put("categoryId", "22");
            JSONArray tagsIn = j.optJSONArray("tags");
            if (tagsIn != null && tagsIn.length() > 0) {
                JSONArray tags = new JSONArray();
                int total = 0;
                for (int i = 0; i < tagsIn.length(); i++) {
                    String t = clean(tagsIn.optString(i), 100);
                    if (t.isEmpty() || total + t.length() > 450) continue;
                    tags.put(t);
                    total += t.length() + 1;
                }
                snippet.put("tags", tags);
            }
            JSONObject status = new JSONObject();
            String publishAt = j.optString("publishAt", "");
            if (!publishAt.isEmpty()) {
                status.put("privacyStatus", "private");
                status.put("publishAt", publishAt);
            } else {
                status.put("privacyStatus", j.optString("privacy", "public"));
            }
            status.put("selfDeclaredMadeForKids", false);
            JSONObject meta = new JSONObject();
            meta.put("snippet", snippet);
            meta.put("status", status);

            String ytId = uploadVideo(appId, title, video, meta);

            String warning = "";
            String thumb = j.optString("thumbPath", "");
            if (!thumb.isEmpty() && new File(thumb).exists()) {
                publish(this, appId, "thumbnail", 100, "", ytId);
                updateNotification("Setting thumbnail: " + title, 100, true);
                try {
                    setThumbnail(ytId, new File(thumb));
                } catch (Exception e) {
                    warning = "video uploaded, but thumbnail failed: " + e.getMessage()
                            + (e.getMessage() != null && e.getMessage().toLowerCase().contains("permission")
                            ? " (verify your channel with your phone number at youtube.com/verify)" : "");
                }
            }
            publish(this, appId, "done", 100, warning, ytId);
            notifyFinished("Uploaded to YouTube", title);
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "Upload failed" : e.getMessage();
            publish(this, appId, "error", 0, msg, "");
            notifyFinished("YouTube upload failed", title + ": " + msg);
        }
    }

    private String uploadVideo(String appId, String title, File video, JSONObject meta) throws Exception {
        long total = video.length();
        String mime = guessVideoMime(video.getName());

        // 1) start a resumable session
        HttpURLConnection c = (HttpURLConnection) new URL(
                "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status").openConnection();
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setConnectTimeout(30000);
        c.setReadTimeout(60000);
        c.setRequestProperty("Authorization", "Bearer " + YouTubeApi.accessToken(this));
        c.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        c.setRequestProperty("X-Upload-Content-Length", String.valueOf(total));
        c.setRequestProperty("X-Upload-Content-Type", mime);
        byte[] body = meta.toString().getBytes(StandardCharsets.UTF_8);
        c.setFixedLengthStreamingMode(body.length);
        try (OutputStream os = c.getOutputStream()) {
            os.write(body);
        }
        int code = c.getResponseCode();
        if (code >= 400) throw new YouTubeApi.HttpError(code, YouTubeApi.readAll(c.getErrorStream()));
        String session = c.getHeaderField("Location");
        if (session == null) throw new Exception("YouTube did not start the upload");

        // 2) send the file in chunks, resuming after network errors
        long offset = 0;
        int failures = 0;
        byte[] buf = new byte[CHUNK];
        try (RandomAccessFile raf = new RandomAccessFile(video, "r")) {
            while (true) {
                int pct = total == 0 ? 0 : (int) (offset * 100 / total);
                publish(this, appId, "uploading", pct, "", "");
                updateNotification("Uploading: " + title, pct, false);
                try {
                    int len = (int) Math.min(CHUNK, total - offset);
                    raf.seek(offset);
                    raf.readFully(buf, 0, len);
                    HttpURLConnection u = (HttpURLConnection) new URL(session).openConnection();
                    u.setRequestMethod("PUT");
                    u.setDoOutput(true);
                    u.setInstanceFollowRedirects(false);
                    u.setConnectTimeout(30000);
                    u.setReadTimeout(120000);
                    u.setRequestProperty("Authorization", "Bearer " + YouTubeApi.accessToken(this));
                    u.setRequestProperty("Content-Type", mime);
                    if (len > 0) {
                        u.setRequestProperty("Content-Range", "bytes " + offset + "-" + (offset + len - 1) + "/" + total);
                    }
                    u.setFixedLengthStreamingMode(len);
                    try (OutputStream os = u.getOutputStream()) {
                        os.write(buf, 0, len);
                    }
                    int rc = u.getResponseCode();
                    if (rc == 200 || rc == 201) {
                        JSONObject res = new JSONObject(YouTubeApi.readAll(u.getInputStream()));
                        return res.getString("id");
                    } else if (rc == 308) {
                        offset = nextOffset(u.getHeaderField("Range"), offset + len);
                        failures = 0;
                    } else if (rc >= 500) {
                        throw new IOException("YouTube server error " + rc);
                    } else {
                        throw new YouTubeApi.HttpError(rc, YouTubeApi.readAll(u.getErrorStream()));
                    }
                } catch (IOException e) {
                    if (++failures > 6) throw new Exception("Network problem, upload stopped: " + e.getMessage());
                    Thread.sleep(Math.min(60000, 2000L << failures));
                    offset = queryOffset(session, total, mime, offset);
                }
            }
        }
    }

    /** Asks YouTube how many bytes it already has (after a network error). */
    private long queryOffset(String session, long total, String mime, long fallback) {
        try {
            HttpURLConnection q = (HttpURLConnection) new URL(session).openConnection();
            q.setRequestMethod("PUT");
            q.setDoOutput(true);
            q.setInstanceFollowRedirects(false);
            q.setRequestProperty("Authorization", "Bearer " + YouTubeApi.accessToken(this));
            q.setRequestProperty("Content-Range", "bytes */" + total);
            q.setRequestProperty("Content-Type", mime);
            q.setFixedLengthStreamingMode(0);
            q.getOutputStream().close();
            if (q.getResponseCode() == 308) return nextOffset(q.getHeaderField("Range"), 0);
        } catch (Exception ignored) {
        }
        return fallback;
    }

    private static long nextOffset(String range, long fallback) {
        // "bytes=0-12345" -> 12346
        if (range == null) return fallback == 0 ? 0 : fallback;
        int dash = range.lastIndexOf('-');
        try {
            return Long.parseLong(range.substring(dash + 1).trim()) + 1;
        } catch (Exception e) {
            return fallback;
        }
    }

    private void setThumbnail(String videoId, File image) throws Exception {
        byte[] jpeg = toJpeg(image);
        HttpURLConnection c = (HttpURLConnection) new URL(
                "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=" + videoId).openConnection();
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setConnectTimeout(30000);
        c.setReadTimeout(60000);
        c.setRequestProperty("Authorization", "Bearer " + YouTubeApi.accessToken(this));
        c.setRequestProperty("Content-Type", "image/jpeg");
        c.setFixedLengthStreamingMode(jpeg.length);
        try (OutputStream os = c.getOutputStream()) {
            os.write(jpeg);
        }
        YouTubeApi.readResponse(c);
    }

    /** YouTube thumbnails: max 2 MB. Re-encode to a JPEG up to 1280 px wide. */
    private static byte[] toJpeg(File f) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(f.getPath(), o);
        int sample = 1;
        while (o.outWidth / (sample * 2) >= 1280) sample *= 2;
        o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        Bitmap b = BitmapFactory.decodeFile(f.getPath(), o);
        if (b == null) throw new Exception("Thumbnail image could not be read");
        if (b.getWidth() > 1280) {
            int h = Math.round(b.getHeight() * (1280f / b.getWidth()));
            b = Bitmap.createScaledBitmap(b, 1280, h, true);
        }
        int q = 92;
        byte[] out;
        do {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.JPEG, q, bo);
            out = bo.toByteArray();
            q -= 10;
        } while (out.length > 2_000_000 && q > 30);
        return out;
    }

    private static String clean(String s, int max) {
        if (s == null) return "";
        s = s.replace("<", "").replace(">", "").trim();
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static String guessVideoMime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
        if (n.endsWith(".mov")) return "video/quicktime";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".3gp")) return "video/3gpp";
        if (n.endsWith(".mkv")) return "video/x-matroska";
        if (n.endsWith(".avi")) return "video/x-msvideo";
        return "application/octet-stream";
    }

    // ---------- notifications ----------

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "YouTube uploads", NotificationManager.IMPORTANCE_LOW));
        }
    }

    private Notification build(String text, int pct, boolean indeterminate, boolean ongoing) {
        ensureChannel();
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 7, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(ongoing ? "Faith Finance · YouTube" : text)
                .setContentText(ongoing ? text : null)
                .setContentIntent(pi)
                .setOngoing(ongoing)
                .setOnlyAlertOnce(true);
        if (ongoing) b.setProgress(100, pct, indeterminate);
        return b.build();
    }

    private void startInForeground(String text, int pct, boolean indeterminate) {
        Notification n = build(text, pct, indeterminate, true);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void updateNotification(String text, int pct, boolean indeterminate) {
        try {
            getSystemService(NotificationManager.class).notify(NOTIF_ID, build(text, pct, indeterminate, true));
        } catch (Exception ignored) {
        }
    }

    private void notifyFinished(String title, String text) {
        try {
            ensureChannel();
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
            Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, 8, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setContentIntent(pi).setAutoCancel(true);
            getSystemService(NotificationManager.class).notify((int) (System.currentTimeMillis() & 0xffff) + 5000, b.build());
        } catch (Exception ignored) {
        }
    }
}
