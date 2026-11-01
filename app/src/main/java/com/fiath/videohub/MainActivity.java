package com.fiath.videohub;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

public class MainActivity extends Activity {

    static final String EXTRA_REMINDER_ID = "reminderId";

    private WebView webView;
    private boolean pageLoaded = false;
    private String pendingReminderId = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);

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
    }
}
