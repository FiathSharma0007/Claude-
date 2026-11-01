package com.fiath.videohub;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Google sign-in (OAuth 2.0 for installed apps, loopback redirect + PKCE) and token storage
 * for the YouTube Data API. The user supplies their own "Desktop app" OAuth client.
 */
final class YouTubeApi {

    interface Callback {
        void done(String error);
    }

    private static final String PREFS = "youtube";
    private static final String SCOPES =
            "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

    private YouTubeApi() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void saveConfig(Context c, String clientId, String clientSecret) {
        SharedPreferences.Editor e = prefs(c).edit();
        String oldId = prefs(c).getString("clientId", "");
        e.putString("clientId", clientId.trim());
        if (clientSecret != null && !clientSecret.trim().isEmpty()) e.putString("clientSecret", clientSecret.trim());
        if (!oldId.equals(clientId.trim())) {
            e.remove("refreshToken").remove("accessToken").remove("expiresAt").remove("channel");
        }
        e.apply();
    }

    static JSONObject status(Context c) {
        SharedPreferences p = prefs(c);
        JSONObject o = new JSONObject();
        try {
            o.put("clientId", p.getString("clientId", ""));
            o.put("hasSecret", !p.getString("clientSecret", "").isEmpty());
            o.put("connected", !p.getString("refreshToken", "").isEmpty());
            o.put("channel", p.getString("channel", ""));
        } catch (Exception ignored) {
        }
        return o;
    }

    static void disconnect(Context c) {
        final String token = prefs(c).getString("refreshToken", "");
        prefs(c).edit().remove("refreshToken").remove("accessToken").remove("expiresAt").remove("channel").apply();
        if (!token.isEmpty()) {
            new Thread(() -> {
                try {
                    post("https://oauth2.googleapis.com/revoke", "token=" + enc(token));
                } catch (Exception ignored) {
                }
            }).start();
        }
    }

    /**
     * Opens Google sign-in in the browser and waits on 127.0.0.1 for the redirect.
     * Calls cb on a background thread.
     */
    static void connect(Context ctx, java.util.function.Consumer<String> openBrowser, Callback cb) {
        final Context c = ctx.getApplicationContext();
        final String clientId = prefs(c).getString("clientId", "");
        final String secret = prefs(c).getString("clientSecret", "");
        if (clientId.isEmpty() || secret.isEmpty()) {
            cb.done("Client ID and secret are missing");
            return;
        }
        new Thread(() -> {
            ServerSocket server = null;
            try {
                server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
                server.setSoTimeout(5 * 60 * 1000);
                String redirect = "http://127.0.0.1:" + server.getLocalPort();
                String verifier = randomString(64);
                String challenge = Base64.encodeToString(
                        MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)),
                        Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
                String state = randomString(24);
                String url = "https://accounts.google.com/o/oauth2/v2/auth"
                        + "?client_id=" + enc(clientId)
                        + "&redirect_uri=" + enc(redirect)
                        + "&response_type=code"
                        + "&scope=" + enc(SCOPES)
                        + "&code_challenge=" + enc(challenge)
                        + "&code_challenge_method=S256"
                        + "&access_type=offline&prompt=consent"
                        + "&state=" + enc(state);
                openBrowser.accept(url);

                String code = null, error = null, gotState = null;
                try (Socket s = server.accept()) {
                    BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                    String line = in.readLine(); // GET /?code=...&state=... HTTP/1.1
                    if (line != null && line.startsWith("GET ")) {
                        String path = line.split(" ")[1];
                        Uri u = Uri.parse("http://localhost" + path);
                        code = u.getQueryParameter("code");
                        error = u.getQueryParameter("error");
                        gotState = u.getQueryParameter("state");
                    }
                    boolean ok = code != null && state.equals(gotState);
                    String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                            + "<style>body{font-family:sans-serif;background:#000;color:#fff;text-align:center;padding:40px 20px}"
                            + "a{display:inline-block;margin-top:24px;background:#FFCC00;color:#000;padding:14px 22px;border-radius:12px;"
                            + "text-decoration:none;font-weight:bold}</style></head><body>"
                            + (ok ? "<h2>YouTube connected &#10003;</h2><p>You can go back to the app now.</p>"
                                  : "<h2>Sign-in was not completed</h2><p>Please go back to the app and try again.</p>")
                            + "<a href='intent://connected#Intent;scheme=faithfinance;package=" + c.getPackageName() + ";end'>Open Faith Finance</a>"
                            + "</body></html>";
                    byte[] body = html.getBytes(StandardCharsets.UTF_8);
                    OutputStream os = s.getOutputStream();
                    os.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + body.length
                            + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    os.write(body);
                    os.flush();
                }
                if (code == null) throw new Exception(error != null ? "Google sign-in: " + error : "Sign-in cancelled");
                if (!state.equals(gotState)) throw new Exception("Sign-in check failed, please try again");

                JSONObject tok = new JSONObject(post("https://oauth2.googleapis.com/token",
                        "code=" + enc(code)
                                + "&client_id=" + enc(clientId)
                                + "&client_secret=" + enc(secret)
                                + "&code_verifier=" + enc(verifier)
                                + "&redirect_uri=" + enc(redirect)
                                + "&grant_type=authorization_code"));
                String refresh = tok.optString("refresh_token", "");
                if (refresh.isEmpty()) throw new Exception("Google did not return a refresh token");
                prefs(c).edit()
                        .putString("refreshToken", refresh)
                        .putString("accessToken", tok.getString("access_token"))
                        .putLong("expiresAt", System.currentTimeMillis() + tok.optLong("expires_in", 3600) * 1000L)
                        .apply();

                try {
                    JSONObject ch = new JSONObject(get(
                            "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", accessToken(c)));
                    JSONArray items = ch.optJSONArray("items");
                    if (items == null || items.length() == 0) {
                        throw new Exception("This Google account has no YouTube channel");
                    }
                    String title = items.getJSONObject(0).getJSONObject("snippet").optString("title");
                    prefs(c).edit().putString("channel", title).apply();
                } catch (Exception e) {
                    if (e.getMessage() != null && e.getMessage().contains("no YouTube channel")) {
                        disconnect(c);
                        throw e;
                    }
                }
                cb.done(null);
            } catch (Exception e) {
                cb.done(e.getMessage() == null ? "Sign-in failed" : e.getMessage());
            } finally {
                try {
                    if (server != null) server.close();
                } catch (Exception ignored) {
                }
            }
        }).start();
    }

    /** Returns a valid access token, refreshing it if needed. Call off the main thread. */
    static synchronized String accessToken(Context c) throws Exception {
        SharedPreferences p = prefs(c);
        String at = p.getString("accessToken", "");
        if (!at.isEmpty() && p.getLong("expiresAt", 0) > System.currentTimeMillis() + 60_000) return at;
        String refresh = p.getString("refreshToken", "");
        if (refresh.isEmpty()) throw new Exception("YouTube is not connected");
        JSONObject tok;
        try {
            tok = new JSONObject(post("https://oauth2.googleapis.com/token",
                    "client_id=" + enc(p.getString("clientId", ""))
                            + "&client_secret=" + enc(p.getString("clientSecret", ""))
                            + "&refresh_token=" + enc(refresh)
                            + "&grant_type=refresh_token"));
        } catch (HttpError e) {
            if (e.body.contains("invalid_grant")) {
                p.edit().remove("refreshToken").remove("accessToken").apply();
                throw new Exception("YouTube login expired. Please connect again in Accounts.");
            }
            throw e;
        }
        at = tok.getString("access_token");
        p.edit().putString("accessToken", at)
                .putLong("expiresAt", System.currentTimeMillis() + tok.optLong("expires_in", 3600) * 1000L).apply();
        return at;
    }

    // ---------- tiny HTTP helpers ----------

    static final class HttpError extends Exception {
        final int code;
        final String body;

        HttpError(int code, String body) {
            super(readableError(code, body));
            this.code = code;
            this.body = body;
        }
    }

    static String readableError(int code, String body) {
        try {
            JSONObject o = new JSONObject(body);
            Object err = o.opt("error");
            if (err instanceof JSONObject) {
                JSONObject e = (JSONObject) err;
                String msg = e.optString("message", "");
                JSONArray errs = e.optJSONArray("errors");
                String reason = errs != null && errs.length() > 0 ? errs.getJSONObject(0).optString("reason") : "";
                if ("quotaExceeded".equals(reason)) return "Daily YouTube upload limit reached. Try again tomorrow.";
                if ("uploadLimitExceeded".equals(reason)) return "Your channel reached its upload limit for today.";
                if (!msg.isEmpty()) return msg.replaceAll("<[^>]*>", "");
            } else if (err instanceof String) {
                String d = o.optString("error_description", "");
                return d.isEmpty() ? (String) err : d;
            }
        } catch (Exception ignored) {
        }
        return "HTTP " + code;
    }

    static String post(String url, String form) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        try (OutputStream os = c.getOutputStream()) {
            os.write(form.getBytes(StandardCharsets.UTF_8));
        }
        return readResponse(c);
    }

    static String get(String url, String token) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Authorization", "Bearer " + token);
        return readResponse(c);
    }

    static String readResponse(HttpURLConnection c) throws Exception {
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = in == null ? "" : readAll(in);
        if (code >= 400) throw new HttpError(code, body);
        return body;
    }

    static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) > 0) bo.write(b, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8");
    }

    private static String randomString(int len) {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        SecureRandom r = new SecureRandom();
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) sb.append(chars.charAt(r.nextInt(chars.length())));
        return sb.toString();
    }
}
