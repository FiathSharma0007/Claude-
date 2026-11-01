# Video-editing skills

Each folder here is one skill: `.claude/skills/<name>/SKILL.md`, plus any helper
scripts it needs. Run one with `/<name>` and a clip.

Every SKILL.md follows the same layout:

1. Frontmatter `description`: when to use the skill.
2. Method: the exact steps, in order.
3. Render settings: codec, quality, audio, output naming.

Shared defaults (each skill may override):

- Video: H.264 (`libx264`), `-crf 18`, `-preset medium`, `-pix_fmt yuv420p`
- Audio: AAC 192 kb/s, 48 kHz
- Container: MP4 with `-movflags +faststart`
- Output: next to the input as `<input-name>_<skill>.mp4`; never overwrite the source

Tools available in this environment: ffmpeg/ffprobe 6.1.1 (libx264, libx265,
libvpx-vp9, libopus, libass, drawtext, loudnorm, xfade, zoompan) and Node 22.

## Skills

_None yet._
