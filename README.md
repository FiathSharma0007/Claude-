# Faith Finance

Faith Finance is an Android app for tracking video uploads. Each video is stored once in a main content library and is tracked separately on four platforms: **YouTube, Instagram, Facebook and TikTok**.

## Keep your videos in the app

- **From the gallery:** in **+ New Video**, choose the video and thumbnail from your phone's gallery. The title is filled from the file name if empty.
- **Add video file:** you can also add or change the video later. A copy is saved inside the app and plays there.
- **Thumbnail:** choose an image. It is shown with the video and in the library list.
- **Title, description and hashtags** are kept with the video. "Copy to all 4 platforms" fills every platform with them.
- **Checklist section** (☑ button in the bottom bar): every video you add appears there automatically with 4 checkboxes, one per platform.
- **Share video to YouTube / Instagram / Facebook / TikTok** opens that app with the video and copies the caption to the clipboard.

Because the app keeps its own copy of each video, it uses extra phone storage. Uninstalling the app deletes the saved videos and data.

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

Direct link (open it on your Android phone):

**https://github.com/FiathSharma0007/Claude-/releases/latest/download/FaithFinance.apk**

After it downloads, tap the file to install it. You may need to allow "Install unknown apps" for your browser or file manager.

Every push rebuilds the APK and updates this link. The same file is also on the repository's **Releases** page.

## Build it yourself

You need JDK 17 and the Android SDK.

```
./gradlew assembleDebug
# output: app/build/outputs/apk/debug/app-debug.apk
```

## Code layout

- `app/src/main/assets/`: the app UI (`index.html`, `style.css`, `app.js`). Data is saved on the phone.
- `app/src/main/java/com/fiath/videohub/`: the WebView host and reminder notifications. Reminders use AlarmManager and are restored after the phone restarts.
