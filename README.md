# VideoHub

VideoHub is an Android app for tracking video uploads. Each video is stored once in a main content library and is tracked separately on four platforms: **YouTube, Instagram, Facebook and TikTok**.

## Shared video feature

- Creating a video adds **one** record to the library. The YouTube, Instagram, Facebook and TikTok sections all show that same record, so there are no duplicate entries.
- Each platform has its own fields for that video:
  - Upload checkbox
  - Upload status (Pending / Scheduled / Uploaded / Failed)
  - Scheduled date and time
  - Title
  - Description and hashtags
  - Published video URL
  - Reminder notification (at the scheduled time, or 15 min, 30 min, 1 hour or 1 day before it)
- Ticking **Uploaded** on one platform completes only that platform. The other platforms stay pending until you tick them yourself.
- Each video shows its combined progress, for example **2/4 platforms completed**.
- If a scheduled time passes and the video is still not uploaded on that platform, it is marked **Overdue**.

## Download the APK

1. Open the repository on GitHub and go to **Actions → Build APK**.
2. Open the latest successful run and download the **VideoHub-apk** artifact (a zip file).
3. Unzip it, copy `app-debug.apk` to your phone and install it. You may need to allow "Install unknown apps".

## Build it yourself

You need JDK 17 and the Android SDK.

```
./gradlew assembleDebug
# output: app/build/outputs/apk/debug/app-debug.apk
```

## Code layout

- `app/src/main/assets/`: the app UI (`index.html`, `style.css`, `app.js`). Data is saved on the phone.
- `app/src/main/java/com/fiath/videohub/`: the WebView host and reminder notifications. Reminders use AlarmManager and are restored after the phone restarts.
