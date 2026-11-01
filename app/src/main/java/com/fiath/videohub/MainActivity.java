package com.fiath.videohub;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {

    static final String EXTRA_REMINDER_ID = "reminderId";
    private static final int REQ_PICK = 1001;
    private static final int REQ_STORAGE = 1002;

    private WebView webView;
    private boolean pageLoaded = false;
    private String pendingReminderId = null;

    // Which video / which kind ("video" or "thumb") the open file picker is for.
    private String pickVideoId = null;
    private String pickKind = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            pickVideoId = savedInstanceState.getString("pickVideoId");
            pickKind = savedInstanceState.getString("pickKind");
        }

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);

        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    openExternal(uri.toString());
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                deliverPendingReminder();
            }
        });

        pendingReminderId = getIntent().getStringExtra(EXTRA_REMINDER_ID);
        webView.loadUrl("file:///android_asset/index.html");

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("pickVideoId", pickVideoId);
        out.putString("pickKind", pickKind);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String id = intent.getStringExtra(EXTRA_REMINDER_ID);
        if (id != null) {
            pendingReminderId = id;
            deliverPendingReminder();
        }
    }

    private void deliverPendingReminder() {
        if (!pageLoaded || pendingReminderId == null) return;
        String id = JSONObject.quote(pendingReminderId);
        pendingReminderId = null;
        webView.evaluateJavascript("window.openReminder && window.openReminder(" + id + ")", null);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        webView.evaluateJavascript("window.handleBack ? window.handleBack() : false", value -> {
            if (!"true".equals(value)) {
                MainActivity.super.onBackPressed();
            }
        });
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
    }

    // ---------- media: pick + copy into app storage ----------

    private File mediaDir() {
        File d = new File(getFilesDir(), "media");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private void startPicker(String videoId, String kind) {
        pickVideoId = videoId;
        pickKind = kind;
        // Android 12 and older: the gallery needs read access to the phone's media.
        if (Build.VERSION.SDK_INT < 33
                && checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, REQ_STORAGE);
            return; // picker opens from onRequestPermissionsResult
        }
        launchGallery();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_STORAGE && pickKind != null) launchGallery();
    }

    /** Opens the phone's photo gallery for a video ("video") or an image ("thumb"). */
    @SuppressWarnings("deprecation")
    private void launchGallery() {
        boolean video = "video".equals(pickKind);
        String type = video ? "video/*" : "image/*";

        java.util.List<Intent> tries = new java.util.ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            // Android photo picker (gallery with albums).
            tries.add(new Intent(MediaStore.ACTION_PICK_IMAGES).setType(type));
        }
        tries.add(new Intent(Intent.ACTION_PICK, video
                ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI));
        Intent getContent = new Intent(Intent.ACTION_GET_CONTENT);
        getContent.addCategory(Intent.CATEGORY_OPENABLE);
        getContent.setType(type);
        tries.add(getContent);

        for (Intent i : tries) {
            try {
                startActivityForResult(i, REQ_PICK);
                return;
            } catch (ActivityNotFoundException ignored) {
            }
        }
        Toast.makeText(this, "No gallery app found", Toast.LENGTH_SHORT).show();
        pickVideoId = null;
        pickKind = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK) return;
        final String id = pickVideoId;
        final String kind = pickKind;
        pickVideoId = null;
        pickKind = null;
        if (resultCode != RESULT_OK || data == null || data.getData() == null || id == null) {
            js("window.onMediaCancel && window.onMediaCancel(" + JSONObject.quote(String.valueOf(id)) + ")");
            return;
        }
        final Uri uri = data.getData();
        new Thread(() -> copyIntoApp(id, kind, uri)).start();
    }

    private void copyIntoApp(String id, String kind, Uri uri) {
        String name = "file";
        long size = -1;
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int si = c.getColumnIndex(OpenableColumns.SIZE);
                if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni);
                if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
            }
        } catch (Exception ignored) {
        }

        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot >= 0 && dot < name.length() - 1) {
            ext = name.substring(dot + 1).toLowerCase();
        } else {
            String mime = getContentResolver().getType(uri);
            String e = mime == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            ext = e != null ? e : ("video".equals(kind) ? "mp4" : "jpg");
        }
        String safeId = id.replaceAll("[^A-Za-z0-9_-]", "");
        File out = new File(mediaDir(), safeId + "_" + kind + "_" + System.currentTimeMillis() + "." + ext);

        String q = JSONObject.quote(id), k = JSONObject.quote(kind);
        try (InputStream in = getContentResolver().openInputStream(uri);
             OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new Exception("Cannot open file");
            byte[] buf = new byte[256 * 1024];
            long done = 0;
            int lastPct = -1;
            int n;
            while ((n = in.read(buf)) > 0) {
                os.write(buf, 0, n);
                done += n;
                if (size > 0) {
                    int pct = (int) (done * 100 / size);
                    if (pct != lastPct && pct % 2 == 0) {
                        lastPct = pct;
                        js("window.onMediaProgress && window.onMediaProgress(" + q + "," + k + "," + pct + ")");
                    }
                }
            }
            os.flush();
            long finalSize = out.length();
            js("window.onMediaPicked && window.onMediaPicked(" + q + "," + k + ","
                    + JSONObject.quote(out.getAbsolutePath()) + "," + JSONObject.quote(name) + "," + finalSize + ")");
        } catch (Exception e) {
            out.delete();
            String msg = e.getMessage() == null ? "Copy failed" : e.getMessage();
            if (msg.contains("ENOSPC")) msg = "Phone storage is full";
            js("window.onMediaError && window.onMediaError(" + q + "," + k + "," + JSONObject.quote(msg) + ")");
        }
    }

    private boolean isOurMedia(String path) {
        try {
            File f = new File(path).getCanonicalFile();
            return f.getPath().startsWith(mediaDir().getCanonicalPath() + File.separator);
        } catch (Exception e) {
            return false;
        }
    }

    private static String platformPackage(String platform) {
        switch (platform == null ? "" : platform) {
            case "youtube": return "com.google.android.youtube";
            case "instagram": return "com.instagram.android";
            case "facebook": return "com.facebook.katana";
            case "tiktok": return "com.zhiliaoapp.musically";
            default: return null;
        }
    }

    private void shareFile(String path, String platform, String caption) {
        if (!isOurMedia(path) || !new File(path).exists()) {
            Toast.makeText(this, "Video file not found", Toast.LENGTH_SHORT).show();
            return;
        }
        if (caption != null && !caption.isEmpty()) copyToClipboard(caption);

        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", new File(path));
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("video/*");
        send.putExtra(Intent.EXTRA_STREAM, uri);
        if (caption != null) send.putExtra(Intent.EXTRA_TEXT, caption);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(ClipData.newRawUri("video", uri));

        String pkg = platformPackage(platform);
        if (pkg != null) {
            Intent direct = new Intent(send).setPackage(pkg);
            try {
                startActivity(direct);
                Toast.makeText(this, "Caption copied. Paste it in the app.", Toast.LENGTH_LONG).show();
                return;
            } catch (ActivityNotFoundException ignored) {
                // App not installed: fall back to the share sheet.
            }
        }
        startActivity(Intent.createChooser(send, "Share video"));
    }

    private void copyToClipboard(String text) {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("caption", text));
    }

    private void js(String code) {
        runOnUiThread(() -> webView.evaluateJavascript(code, null));
    }

    /** Methods callable from JavaScript as window.Android.* */
    class Bridge {
        @JavascriptInterface
        public void scheduleReminder(String id, double atMillis, String title, String text) {
            ReminderScheduler.schedule(getApplicationContext(), id, (long) atMillis, title, text);
        }

        @JavascriptInterface
        public void cancelReminder(String id) {
            ReminderScheduler.cancel(getApplicationContext(), id);
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> openExternal(url));
        }

        /** kind: "video" or "thumb". Result arrives in window.onMediaPicked / onMediaError / onMediaCancel. */
        @JavascriptInterface
        public void pickMedia(String videoId, String kind) {
            runOnUiThread(() -> startPicker(videoId, kind));
        }

        @JavascriptInterface
        public void deleteMedia(String path) {
            if (path != null && isOurMedia(path)) new File(path).delete();
        }

        @JavascriptInterface
        public void shareVideo(String path, String platform, String caption) {
            runOnUiThread(() -> shareFile(path, platform, caption));
        }

        @JavascriptInterface
        public void copyText(String text) {
            runOnUiThread(() -> {
                copyToClipboard(text);
                Toast.makeText(MainActivity.this, "Copied", Toast.LENGTH_SHORT).show();
            });
        }
    }
}
