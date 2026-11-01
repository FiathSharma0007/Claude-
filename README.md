# Faith Finance

Faith Finance is an Android app for planning and tracking video uploads on **YouTube, Instagram, Facebook and TikTok**.

## How it works

- **Separate platforms:** every video belongs to one platform (YouTube, Instagram, Facebook or TikTok). A video added in the Instagram section stays in Instagram, with its own title, description, hashtags, video file and thumbnail.
- **From the gallery:** in **+ New Video**, choose the platform, then the video and thumbnail from your phone's gallery. A copy is kept inside the app.
- **Checklist** (☑ in the bottom bar) has two parts:
  - **Content plan:** weeks of daily topics (Week 1 · Money Psychology · Day 1…Day 7) with round checkboxes and overall upload progress such as 1/38. Tick a topic after its video is uploaded. Add weeks and paste many topics at once (one per line). Tap a topic to edit it or to create its video for a platform.
  - **Videos:** every video appears automatically, grouped by platform, with its own checkbox.
- Each video has: upload checkbox, status, scheduled date and time, published URL and reminder notification. Overdue videos are marked.
- **Library** shows all videos with a count per platform.

## Connect YouTube (auto upload)

Tap the 🔗 button (Connected accounts). Follow the setup guide in the app once: create a free Google Cloud project, enable *YouTube Data API v3*, create an OAuth client of type **Desktop app**, and paste its Client ID and secret. Then open a YouTube video and tap **Upload to YouTube**: the video, thumbnail, title, description and hashtags are sent to your channel. Progress shows in a notification, so you can leave the app.

Important: YouTube keeps videos uploaded from an unverified API project **private** until the project passes Google's YouTube API Services audit.

Instagram, Facebook and TikTok auto upload are not built yet. For those, use **Share to … app**: it opens the app with the video and copies the caption.

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
