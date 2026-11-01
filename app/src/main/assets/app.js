/* Faith Finance: each video belongs to ONE platform (YouTube, Instagram, Facebook or TikTok). */
(function () {
  'use strict';

  var STORAGE_KEY = 'videohub.v1';
  var PLATFORMS = [
    { key: 'youtube', name: 'YouTube' },
    { key: 'instagram', name: 'Instagram' },
    { key: 'facebook', name: 'Facebook' },
    { key: 'tiktok', name: 'TikTok' }
  ];
  var STATUSES = [
    { key: 'pending', name: 'Pending' },
    { key: 'scheduled', name: 'Scheduled' },
    { key: 'uploaded', name: 'Uploaded' },
    { key: 'failed', name: 'Failed' }
  ];
  var LEADS = [
    { v: 0, name: 'At scheduled time' },
    { v: 15, name: '15 min before' },
    { v: 30, name: '30 min before' },
    { v: 60, name: '1 hour before' },
    { v: 1440, name: '1 day before' }
  ];
  var PRIVACY = [
    { k: 'public', n: 'Public' },
    { k: 'unlisted', n: 'Unlisted' },
    { k: 'private', n: 'Private' }
  ];

  var native = window.Android || null;
  // ui.tab: library | checklist | youtube | instagram | facebook | tiktok ; ui.page: null | 'accounts'
  var ui = { tab: 'library', page: null, videoId: null, filters: {}, draft: null, copying: null, form: null };
  var data = load();

  // ---------- storage + migration ----------
  function load() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { d = null; }
    if (!d || !Array.isArray(d.videos)) d = { version: 2, videos: [] };
    if (d.version !== 2) d = migrateV1(d);
    d.videos.forEach(normalize);
    if (!d.plan || !Array.isArray(d.plan.weeks)) d.plan = seedPlan();
    return d;
  }
  // Content plan: weeks of daily topics, ticked after the video is uploaded.
  function seedPlan() {
    return {
      weeks: [{
        id: 'w' + Date.now().toString(36),
        name: 'Week 1',
        subtitle: 'Money Psychology',
        open: true,
        topics: [
          'Middle Class log ameer kyun nahi ban paate?',
          'Hum jitna kamate hain utna bacha kyun nahi paate?',
          'Rich Mindset vs Poor Mindset – asli difference kya hai?',
          'Lifestyle Inflation aapko gareeb kaise banati hai?',
          'Log dikhave ke liye karz kyun lete hain?',
          'Kya paisa sach mein khushi khareed sakta hai?',
          'Ameer log paisa kharch karne ke baare mein kaise sochte hain?'
        ].map(function (t, i) { return { id: 't' + i + Date.now().toString(36), title: t, done: false }; })
      }]
    };
  }
  // v1: one shared video with 4 platform entries -> v2: one separate video per platform.
  function migrateV1(old) {
    var out = { version: 2, videos: [] };
    old.videos.forEach(function (v) {
      if (!v.platforms) return;
      PLATFORMS.forEach(function (p) {
        var pe = v.platforms[p.key];
        if (!pe) return;
        if (native) native.cancelReminder(v.id + '__' + p.key);
        out.videos.push({
          id: v.id + '_' + p.key,
          platform: p.key,
          title: pe.title || v.title,
          description: pe.description != null ? pe.description : v.description,
          hashtags: pe.hashtags != null ? pe.hashtags : v.hashtags,
          video: v.video || null,
          thumb: v.thumb || null,
          status: pe.status || 'pending',
          scheduledAt: pe.scheduledAt || '',
          url: pe.url || '',
          reminder: pe.reminder !== false,
          reminderLead: pe.reminderLead != null ? pe.reminderLead : 30,
          uploadedAt: pe.uploadedAt || null,
          createdAt: v.createdAt || Date.now()
        });
      });
    });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
    return out;
  }
  function normalize(v) {
    if (!v.status) v.status = 'pending';
    if (v.scheduledAt == null) v.scheduledAt = '';
    if (v.url == null) v.url = '';
    if (v.reminder == null) v.reminder = true;
    if (v.reminderLead == null) v.reminderLead = 30;
    if (!v.privacy) v.privacy = 'public';
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { toast('Could not save'); }
  }
  var saveTimer = null;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }

  // ---------- model ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function findVideo(id) {
    for (var i = 0; i < data.videos.length; i++) if (data.videos[i].id === id) return data.videos[i];
    return null;
  }
  function pname(key) {
    for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].key === key) return PLATFORMS[i].name;
    return key;
  }
  function isPlatform(key) { return PLATFORMS.some(function (p) { return p.key === key; }); }
  function isOverdue(v) {
    if (v.status === 'uploaded' || !v.scheduledAt) return false;
    return new Date(v.scheduledAt).getTime() < Date.now();
  }
  function videosOf(key) { return data.videos.filter(function (v) { return v.platform === key; }); }

  function createVideo(platform, title, description, hashtags, draft) {
    var v = {
      id: draft && draft.id ? draft.id : uid(),
      platform: platform,
      title: title, description: description, hashtags: hashtags,
      video: draft && draft.video ? draft.video : null,
      thumb: draft && draft.thumb ? draft.thumb : null,
      topicId: draft && draft.topicId ? draft.topicId : null,
      createdAt: Date.now()
    };
    normalize(v);
    data.videos.push(v);
    save();
    return v;
  }

  function setUploaded(v, uploaded) {
    if (uploaded) { v.status = 'uploaded'; v.uploadedAt = Date.now(); }
    else { v.status = v.scheduledAt ? 'scheduled' : 'pending'; v.uploadedAt = null; }
    save();
    syncReminder(v);
  }

  // ---------- reminders ----------
  function syncReminder(v) {
    if (!native) return;
    var at = v.scheduledAt ? new Date(v.scheduledAt).getTime() - (v.reminderLead || 0) * 60000 : NaN;
    if (v.reminder && v.status !== 'uploaded' && !isNaN(at) && at > Date.now()) {
      native.scheduleReminder(v.id, at, 'Upload reminder · ' + pname(v.platform),
        '"' + v.title + '" is scheduled for ' + pname(v.platform) + ' at ' + fmtDate(v.scheduledAt) + '.');
    } else {
      native.cancelReminder(v.id);
    }
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(x) {
    if (!x) return '';
    var d = new Date(x);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }
  function $(id) { return document.getElementById(id); }
  function mediaSrc(path) { return /^(blob:|https?:|file:|data:)/.test(path) ? path : 'file://' + path; }
  function fmtSize(b) {
    if (!b) return '';
    if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }
  function caption(v) {
    return [v.title, v.description, v.hashtags].filter(function (x) { return x && String(x).trim(); }).join('\n\n');
  }
  function copyText(text) {
    if (native) { native.copyText(text); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Copied'); });
  }
  function statusPill(v) {
    if (isOverdue(v)) return '<span class="pill overdue">Overdue</span>';
    var s = STATUSES.filter(function (x) { return x.key === v.status; })[0];
    return '<span class="pill ' + v.status + '">' + esc(s ? s.name : v.status) + '</span>';
  }
  function badge(key) {
    return '<span class="pbadge ' + key + '"><span class="dot ' + key + '"></span>' + pname(key) + '</span>';
  }
  function chips(tabKey, options) {
    var cur = ui.filters[tabKey] || 'all';
    return '<div class="chips">' + options.map(function (o) {
      return '<button class="chip' + (o.k === cur ? ' active' : '') + '" data-filter="' + o.k + '">' + esc(o.n) + '</button>';
    }).join('') + '</div>';
  }
  function thumbHtml(v, cls) {
    return v.thumb && v.thumb.path
      ? '<img class="' + cls + '" alt="" src="' + esc(mediaSrc(v.thumb.path)) + '">'
      : '<div class="' + cls + ' none">' + (v.video ? '&#127909;' : 'No video') + '</div>';
  }
  function sortVideos(list) {
    return list.sort(function (a, b) {
      var ua = a.status === 'uploaded' ? 1 : 0, ub = b.status === 'uploaded' ? 1 : 0;
      if (ua !== ub) return ua - ub;
      var ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
      var tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
      if (ta !== tb) return ta - tb;
      return b.createdAt - a.createdAt;
    });
  }
  function subline(v) {
    if (v.status === 'uploaded') return 'Uploaded ' + fmtDate(v.uploadedAt);
    if (v.scheduledAt) return 'Scheduled ' + fmtDate(v.scheduledAt);
    return 'Not scheduled';
  }

  // ---------- media (video file + thumbnail) ----------
  function mediaInUse(path, exceptId) {
    return data.videos.some(function (v) {
      return v.id !== exceptId && ((v.video && v.video.path === path) || (v.thumb && v.thumb.path === path));
    });
  }
  function deleteMedia(m, ownerId) {
    if (m && m.path && native && !mediaInUse(m.path, ownerId)) native.deleteMedia(m.path);
  }
  function pickMedia(id, kind) {
    ui.copying = null;
    if (native) { native.pickMedia(id, kind); return; }
    var inp = document.createElement('input'); // browser fallback for testing
    inp.type = 'file';
    inp.accept = kind === 'video' ? 'video/*' : 'image/*';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (f) window.onMediaPicked(id, kind, URL.createObjectURL(f), f.name, f.size);
    };
    inp.click();
  }
  window.onMediaProgress = function (id, kind, pct) {
    var first = !ui.copying;
    ui.copying = { id: id, kind: kind, pct: pct };
    if (ui.draft && ui.draft.id === id) { renderDraftMedia(); return; }
    if (ui.videoId !== id) return;
    var el = $('mediaProgress');
    if (first || !el) { render(); return; }
    el.querySelector('span').textContent = pct + '%';
    var bar = el.querySelector('i');
    if (bar) bar.style.width = pct + '%';
  };
  window.onMediaPicked = function (id, kind, path, name, size) {
    ui.copying = null;
    var field = kind === 'video' ? 'video' : 'thumb';
    if (ui.draft && ui.draft.id === id) {
      deleteMedia(ui.draft[field], id);
      ui.draft[field] = { path: path, name: name, size: size };
      if (kind === 'video' && !$('newTitle').value.trim()) {
        $('newTitle').value = String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      }
      renderDraftMedia();
      return;
    }
    var v = findVideo(id);
    if (!v) { if (native && !mediaInUse(path)) native.deleteMedia(path); return; }
    deleteMedia(v[field], v.id);
    v[field] = { path: path, name: name, size: size };
    save();
    toast(kind === 'video' ? 'Video saved in the app' : 'Thumbnail saved');
    if (ui.videoId === id) render();
  };
  window.onMediaError = function (id, kind, msg) {
    ui.copying = null;
    toast('Could not save file: ' + msg);
    if (ui.draft && ui.draft.id === id) renderDraftMedia(); else if (ui.videoId === id) render();
  };
  window.onMediaCancel = function () {
    if (ui.copying) { ui.copying = null; if (ui.draft) renderDraftMedia(); else render(); }
  };

  // ---------- YouTube connection + upload ----------
  function ytStatus() {
    if (!native || !native.ytStatus) return { available: false };
    try { var s = JSON.parse(native.ytStatus()); s.available = true; return s; } catch (e) { return { available: false }; }
  }
  window.onYtStatus = function (json) {
    var s = {};
    try { s = JSON.parse(json); } catch (e) { /* ignore */ }
    if (s.error) toast('YouTube: ' + s.error);
    else if (s.connected) toast('YouTube connected: ' + (s.channel || 'your channel'));
    render();
  };
  function startYtUpload(v) {
    var st = ytStatus();
    if (!st.available) { toast('YouTube upload works in the Android app'); return; }
    if (!st.connected) { toast('Connect your YouTube account first'); openAccounts(); return; }
    if (!v.video || !v.video.path) { toast('Add the video file first'); return; }
    if (!v.title.trim()) { toast('Add a title first'); return; }
    var publishAt = '';
    if (v.scheduledAt && new Date(v.scheduledAt).getTime() > Date.now() + 60000) {
      publishAt = new Date(v.scheduledAt).toISOString();
    }
    var tags = (v.hashtags || '').split(/[\s,]+/).map(function (t) { return t.replace(/^#/, ''); })
      .filter(function (t) { return t; });
    var desc = [v.description, v.hashtags].filter(function (x) { return x && x.trim(); }).join('\n\n');
    v.yt = { state: 'queued', pct: 0, msg: '' };
    save();
    native.ytUpload(JSON.stringify({
      appId: v.id,
      path: v.video.path,
      thumbPath: v.thumb && v.thumb.path ? v.thumb.path : '',
      title: v.title.slice(0, 100),
      description: desc,
      tags: tags,
      privacy: v.privacy || 'public',
      publishAt: publishAt
    }));
    render();
  }
  // state: queued | uploading | thumbnail | done | error
  window.onYtUpload = function (json) {
    var j;
    try { j = JSON.parse(json); } catch (e) { return; }
    var v = findVideo(j.appId);
    if (!v) { if (native && native.ytClearJob) native.ytClearJob(j.appId); return; }
    var prev = v.yt && v.yt.state;
    v.yt = { state: j.state, pct: j.pct || 0, msg: j.msg || '', youtubeId: j.youtubeId || '' };
    if (j.state === 'done') {
      v.url = 'https://youtu.be/' + j.youtubeId;
      if (v.status !== 'uploaded') setUploaded(v, true);
      if (native && native.ytClearJob) native.ytClearJob(j.appId);
      if (prev !== 'done') toast('Uploaded to YouTube' + (j.msg ? ' (' + j.msg + ')' : ''));
    } else if (j.state === 'error') {
      if (native && native.ytClearJob) native.ytClearJob(j.appId);
      if (prev !== 'error') toast('YouTube upload failed: ' + j.msg);
    }
    save();
    if (ui.videoId === v.id) {
      var el = $('ytProgress');
      if (el && j.state === 'uploading' && prev === 'uploading') {
        el.querySelector('span').textContent = j.pct + '%';
        el.querySelector('i').style.width = j.pct + '%';
        return;
      }
    }
    if (ui.videoId === v.id || ui.tab === 'youtube' || ui.tab === 'library' || ui.tab === 'checklist') render();
  };
  function syncYtJobs() {
    if (!native || !native.ytJobs) return;
    var jobs = {};
    try { jobs = JSON.parse(native.ytJobs()); } catch (e) { return; }
    Object.keys(jobs).forEach(function (k) { window.onYtUpload(JSON.stringify(jobs[k])); });
    // A job the service no longer knows about (app was killed mid-upload) is reset.
    data.videos.forEach(function (v) {
      if (v.yt && (v.yt.state === 'queued' || v.yt.state === 'uploading' || v.yt.state === 'thumbnail') && !jobs[v.id]) {
        v.yt = { state: 'error', pct: 0, msg: 'Upload was interrupted. Try again.' };
      }
    });
    save();
  }

  // ---------- views ----------
  function render() {
    var nav = document.querySelectorAll('#nav button');
    for (var i = 0; i < nav.length; i++) nav[i].classList.toggle('active', nav[i].getAttribute('data-tab') === ui.tab);
    var sub = !!ui.videoId || ui.page === 'accounts';
    $('backBtn').classList.toggle('hidden', !sub);
    $('newBtn').classList.toggle('hidden', sub);
    $('accountsBtn').classList.toggle('hidden', sub);

    if (ui.page === 'accounts') return renderAccounts();
    if (ui.videoId && findVideo(ui.videoId)) return renderDetail(findVideo(ui.videoId));
    ui.videoId = null;
    if (ui.tab === 'checklist') return renderChecklist();
    if (isPlatform(ui.tab)) return renderPlatform(ui.tab);
    return renderLibrary();
  }

  function videoCard(v, showBadge) {
    var ytBusy = v.yt && (v.yt.state === 'queued' || v.yt.state === 'uploading' || v.yt.state === 'thumbnail');
    return '<div class="card platform ' + v.platform + '"><div class="prow">' +
      '<input type="checkbox" class="check" data-quick="' + v.id + '"' + (v.status === 'uploaded' ? ' checked' : '') +
      ' aria-label="Uploaded">' +
      '<div class="lib-row body tap" data-open="' + v.id + '">' + thumbHtml(v, 'lib-thumb') +
      '<div class="body"><h3>' + esc(v.title) + '</h3>' +
      '<div class="meta">' + esc(subline(v)) + (v.reminder && v.scheduledAt && v.status !== 'uploaded' ? ' · &#128276;' : '') + '</div>' +
      '<div class="pills">' + (showBadge ? badge(v.platform) : '') + statusPill(v) +
      (ytBusy ? '<span class="pill scheduled">YouTube ' + (v.yt.state === 'uploading' ? v.yt.pct + '%' : '…') + '</span>' : '') +
      '</div></div></div></div></div>';
  }

  function renderLibrary() {
    $('pageTitle').textContent = 'Faith Finance';
    var all = data.videos.slice();
    var html = '<div class="summary four">' + PLATFORMS.map(function (p) {
      var list = videosOf(p.key);
      var done = list.filter(function (v) { return v.status === 'uploaded'; }).length;
      return '<button class="stat tap" data-tab-go="' + p.key + '"><span class="dot ' + p.key + '"></span><b>' + list.length +
        '</b><span>' + p.name + '<br>' + done + ' uploaded</span></button>';
    }).join('') + '</div>';
    var opts = [{ k: 'all', n: 'All' }].concat(PLATFORMS.map(function (p) { return { k: p.key, n: p.name }; }));
    html += chips('library', opts);
    var f = ui.filters.library || 'all';
    var list = f === 'all' ? all : all.filter(function (v) { return v.platform === f; });
    list.sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (!list.length) {
      html += '<div class="empty">' + (all.length ? 'No videos in this filter.' :
        'No videos yet.<br>Open a platform below (YouTube, Instagram…) and tap <b>+ New Video</b>, or tap it here and choose the platform.') + '</div>';
    }
    list.forEach(function (v) { html += videoCard(v, true); });
    $('view').innerHTML = html;
  }

  function renderChecklist() {
    var mode = ui.filters.clmode || 'plan';
    var seg = '<div class="seg"><button class="' + (mode === 'plan' ? 'active' : '') + '" data-clmode="plan">Content plan</button>' +
      '<button class="' + (mode === 'videos' ? 'active' : '') + '" data-clmode="videos">Videos</button></div>';
    if (mode === 'plan') return renderPlan(seg);
    return renderVideoChecklist(seg);
  }

  function planCounts() {
    var total = 0, done = 0;
    data.plan.weeks.forEach(function (w) {
      w.topics.forEach(function (t) { total++; if (t.done) done++; });
    });
    return { total: total, done: done };
  }
  function findTopic(id) {
    for (var i = 0; i < data.plan.weeks.length; i++) {
      var w = data.plan.weeks[i];
      for (var j = 0; j < w.topics.length; j++) if (w.topics[j].id === id) return { week: w, topic: w.topics[j], index: j };
    }
    return null;
  }
  function findWeek(id) {
    return data.plan.weeks.filter(function (w) { return w.id === id; })[0] || null;
  }

  // Content plan (like: Upload progress 1/38, Week 1 · Money Psychology · 7 videos, Day 1…)
  function renderPlan(seg) {
    $('pageTitle').textContent = 'Upload Checklist';
    var c = planCounts();
    var html = seg + '<div class="card plan-top"><div class="plan-head"><b>Upload progress</b><span class="plan-count">' +
      c.done + '/' + c.total + '</span></div>' +
      '<div class="bar plan-bar"><i style="width:' + (c.total ? c.done / c.total * 100 : 0) + '%"></i></div>' +
      '<div class="plan-hint">Video upload hone ke baad checkbox tick karte jaana.</div>';

    if (!data.plan.weeks.length) html += '<div class="empty" style="padding:20px 0">Abhi koi week nahi hai. Neeche “+ Add week” dabao.</div>';
    data.plan.weeks.forEach(function (w) {
      var wd = w.topics.filter(function (t) { return t.done; }).length;
      html += '<div class="week' + (w.open ? ' open' : '') + '">' +
        '<div class="week-head" data-week-toggle="' + w.id + '"><div class="body"><b>' + esc(w.name) + '</b>' +
        '<div class="meta">' + esc(w.subtitle ? w.subtitle + ' · ' : '') + w.topics.length + ' videos</div></div>' +
        '<span class="week-count' + (wd === w.topics.length && wd ? ' full' : '') + '">' + wd + '/' + w.topics.length + '</span>' +
        '<span class="chev-ico">' + (w.open ? '&#8963;' : '&#8964;') + '</span></div>';
      if (w.open) {
        html += '<div class="topics">';
        w.topics.forEach(function (t, i) {
          var linked = data.videos.filter(function (v) { return v.topicId === t.id; });
          html += '<div class="topic' + (t.done ? ' done' : '') + '">' +
            '<button class="round-check' + (t.done ? ' on' : '') + '" data-topic-check="' + t.id + '" aria-label="Uploaded">' + (t.done ? '&#10003;' : '') + '</button>' +
            '<div class="body tap" data-topic-open="' + t.id + '"><div class="day">Day ' + (i + 1) + '</div>' +
            '<div class="ttl">' + esc(t.title) + '</div>' +
            (linked.length ? '<div class="pills">' + linked.map(function (v) {
              return '<span class="pill ' + (v.status === 'uploaded' ? 'uploaded' : '') + '"><span class="dot ' + v.platform + '"></span>' +
                pname(v.platform) + (v.status === 'uploaded' ? ' &#10003;' : '') + '</span>';
            }).join('') + '</div>' : '') + '</div></div>';
        });
        html += '<div class="row week-actions"><button class="small" data-topic-add="' + w.id + '">+ Add topics</button>' +
          '<button class="small ghost" data-week-edit="' + w.id + '">Edit week</button></div></div>';
      }
      html += '</div>';
    });
    html += '</div><button class="primary add-week" data-week-add="1">+ Add week</button>';
    $('view').innerHTML = html;
  }

  // ---------- small form sheet (week / topic editing) ----------
  function openForm(opts) {
    ui.form = opts;
    var h = '<h2>' + esc(opts.title) + '</h2>' + (opts.hint ? '<p class="hint">' + opts.hint + '</p>' : '');
    (opts.fields || []).forEach(function (f) {
      h += '<label>' + esc(f.label) + (f.multiline
        ? '<textarea data-ff="' + f.key + '" rows="' + (f.rows || 3) + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>'
        : '<input data-ff="' + f.key + '" value="' + esc(f.value || '') + '" placeholder="' + esc(f.placeholder || '') + '">') + '</label>';
    });
    if (opts.extra) h += opts.extra;
    h += '<div class="row end">' + (opts.danger ? '<button class="danger" data-fa="delete" style="margin-right:auto">' + esc(opts.danger) + '</button>' : '') +
      '<button class="ghost" data-fa="cancel">Cancel</button><button class="primary" data-fa="save">' + esc(opts.saveLabel || 'Save') + '</button></div>';
    $('formSheet').innerHTML = h;
    $('formModal').classList.remove('hidden');
  }
  function closeForm() { ui.form = null; $('formModal').classList.add('hidden'); }
  function formValues() {
    var o = {};
    var els = $('formSheet').querySelectorAll('[data-ff]');
    for (var i = 0; i < els.length; i++) o[els[i].getAttribute('data-ff')] = els[i].value;
    return o;
  }
  function lines(s) {
    return String(s || '').split('\n').map(function (x) { return x.replace(/^\s*(day\s*\d+\s*[:.\-–)]?\s*|\d+\s*[.)\-–]\s*)/i, '').trim(); })
      .filter(function (x) { return x; });
  }
  function newTopic(title) { return { id: 't' + uid(), title: title, done: false }; }

  function addWeekForm() {
    openForm({
      title: 'Add week',
      fields: [
        { key: 'name', label: 'Week name', value: 'Week ' + (data.plan.weeks.length + 1) },
        { key: 'subtitle', label: 'Theme', placeholder: 'e.g. Personal Finance' },
        { key: 'topics', label: 'Topics (ek line mein ek topic)', multiline: true, rows: 7, placeholder: 'Day 1 ka topic\nDay 2 ka topic\n…' }
      ],
      onSave: function (v) {
        if (!v.name.trim()) { toast('Week name likho'); return false; }
        data.plan.weeks.push({ id: 'w' + uid(), name: v.name.trim(), subtitle: v.subtitle.trim(), open: true, topics: lines(v.topics).map(newTopic) });
        save();
        return true;
      }
    });
  }
  function editWeekForm(w) {
    openForm({
      title: 'Edit week',
      fields: [
        { key: 'name', label: 'Week name', value: w.name },
        { key: 'subtitle', label: 'Theme', value: w.subtitle }
      ],
      danger: 'Delete week',
      onSave: function (v) {
        if (!v.name.trim()) { toast('Week name likho'); return false; }
        w.name = v.name.trim(); w.subtitle = v.subtitle.trim(); save(); return true;
      },
      onDelete: function () {
        if (!confirm('Delete "' + w.name + '" and its ' + w.topics.length + ' topics?')) return false;
        data.plan.weeks = data.plan.weeks.filter(function (x) { return x !== w; });
        save();
        return true;
      }
    });
  }
  function addTopicsForm(w) {
    openForm({
      title: 'Add topics to ' + w.name,
      hint: 'Ek line mein ek topic. Day number apne aap lagega (Day ' + (w.topics.length + 1) + ' se).',
      fields: [{ key: 'topics', label: 'Topics', multiline: true, rows: 6 }],
      saveLabel: 'Add',
      onSave: function (v) {
        var ts = lines(v.topics);
        if (!ts.length) { toast('Kam se kam ek topic likho'); return false; }
        ts.forEach(function (t) { w.topics.push(newTopic(t)); });
        save();
        return true;
      }
    });
  }
  function topicForm(id) {
    var f = findTopic(id);
    if (!f) return;
    openForm({
      title: f.week.name + ' · Day ' + (f.index + 1),
      fields: [{ key: 'title', label: 'Topic', value: f.topic.title, multiline: true, rows: 2 }],
      extra: '<div class="plat-label" style="margin-top:12px">Is topic ka video banao</div><div class="platform-pick">' +
        PLATFORMS.map(function (p) {
          return '<button type="button" class="pchoice" data-topic-video="' + p.key + '"><span class="dot ' + p.key + '"></span>' + p.name + '</button>';
        }).join('') + '</div>',
      danger: 'Delete',
      onSave: function (v) {
        if (!v.title.trim()) { toast('Topic likho'); return false; }
        f.topic.title = v.title.trim(); save(); return true;
      },
      onDelete: function () {
        if (!confirm('Delete this topic?')) return false;
        f.week.topics.splice(f.index, 1);
        save();
        return true;
      },
      onVideo: function (platform, v) {
        closeForm();
        openModal({ platform: platform, title: (v.title || f.topic.title).trim(), topicId: f.topic.id });
      }
    });
  }

  $('formModal').addEventListener('click', function (e) {
    var o = ui.form;
    if (!o) return;
    if (e.target === $('formModal')) { closeForm(); return; }
    var tv = e.target.closest('[data-topic-video]');
    if (tv && o.onVideo) { o.onVideo(tv.getAttribute('data-topic-video'), formValues()); return; }
    var a = e.target.closest('[data-fa]');
    if (!a) return;
    var act = a.getAttribute('data-fa');
    if (act === 'cancel') { closeForm(); return; }
    var ok = act === 'save' ? o.onSave(formValues()) : (o.onDelete ? o.onDelete() : true);
    if (ok !== false) { closeForm(); render(); }
  });

  // Video checklist: every video appears automatically, grouped by platform, one checkbox each.
  function renderVideoChecklist(seg) {
    $('pageTitle').textContent = 'Upload Checklist';
    var total = data.videos.length;
    var done = data.videos.filter(function (v) { return v.status === 'uploaded'; }).length;
    var html = seg + '<div class="summary">' +
      '<div class="stat"><b>' + total + '</b><span>Videos</span></div>' +
      '<div class="stat"><b>' + done + '</b><span>Uploaded</span></div>' +
      '<div class="stat"><b>' + (total - done) + '</b><span>Left</span></div></div>';
    html += chips('checklist', [{ k: 'all', n: 'All' }, { k: 'pending', n: 'Not uploaded' }, { k: 'done', n: 'Uploaded' }]);
    var f = ui.filters.checklist || 'all';
    if (!total) html += '<div class="empty">No videos yet.<br>Every video you add appears here automatically with its checkbox.</div>';
    PLATFORMS.forEach(function (p) {
      var list = sortVideos(videosOf(p.key));
      if (f === 'pending') list = list.filter(function (v) { return v.status !== 'uploaded'; });
      if (f === 'done') list = list.filter(function (v) { return v.status === 'uploaded'; });
      if (!list.length) return;
      var n = videosOf(p.key).filter(function (v) { return v.status === 'uploaded'; }).length;
      html += '<div class="section-title cl-head"><span class="dot ' + p.key + '"></span>' + p.name +
        '<small>' + n + '/' + videosOf(p.key).length + ' uploaded</small></div><div class="card cl-list">';
      list.forEach(function (v) {
        var on = v.status === 'uploaded';
        html += '<div class="cl-item' + (on ? ' on' : '') + '">' +
          '<label class="cl-box ' + p.key + (on ? ' on' : '') + '"><input type="checkbox" data-quick="' + v.id + '"' + (on ? ' checked' : '') + '>' +
          '<span class="cl-tick">' + (on ? '&#10003;' : '') + '</span></label>' +
          '<div class="lib-row body tap" data-open="' + v.id + '">' + thumbHtml(v, 'cl-thumb') +
          '<div class="body"><b>' + esc(v.title) + '</b><div class="meta">' + esc(subline(v)) + '</div></div></div></div>';
      });
      html += '</div>';
    });
    $('view').innerHTML = html;
  }

  function renderPlatform(key) {
    $('pageTitle').textContent = pname(key);
    var list = videosOf(key);
    var counts = { pending: 0, scheduled: 0, uploaded: 0 };
    list.forEach(function (v) {
      if (v.status === 'uploaded') counts.uploaded++;
      else if (v.status === 'scheduled') counts.scheduled++;
      else counts.pending++;
    });
    var html = '';
    if (key === 'youtube') {
      var st = ytStatus();
      html += '<div class="card acct-strip tap" data-accounts="1"><span class="dot youtube"></span><div class="body">' +
        (st.connected ? '<b>Connected:</b> ' + esc(st.channel || 'YouTube channel') + '<div class="meta">Videos here can be uploaded straight to your channel.</div>'
          : '<b>Connect your YouTube channel</b><div class="meta">Upload video, thumbnail, title &amp; description from the app.</div>') +
        '</div><span class="chev">&#8250;</span></div>';
    } else {
      html += '<div class="card acct-strip tap" data-accounts="1"><span class="dot ' + key + '"></span><div class="body"><b>' + pname(key) +
        ' account</b><div class="meta">Auto upload is coming next. For now use “Share to ' + pname(key) + '”.</div></div><span class="chev">&#8250;</span></div>';
    }
    html += '<div class="summary">' +
      '<div class="stat"><b>' + counts.pending + '</b><span>Pending</span></div>' +
      '<div class="stat"><b>' + counts.scheduled + '</b><span>Scheduled</span></div>' +
      '<div class="stat"><b>' + counts.uploaded + '</b><span>Uploaded</span></div></div>';
    html += chips(key, [{ k: 'all', n: 'All' }, { k: 'todo', n: 'Not uploaded' }, { k: 'uploaded', n: 'Uploaded' }]);
    var f = ui.filters[key] || 'all';
    if (f === 'todo') list = list.filter(function (v) { return v.status !== 'uploaded'; });
    if (f === 'uploaded') list = list.filter(function (v) { return v.status === 'uploaded'; });
    sortVideos(list);
    if (!list.length) {
      html += '<div class="empty">' + (videosOf(key).length ? 'Nothing in this filter.' :
        'No ' + pname(key) + ' videos yet.<br>Tap <b>+ New Video</b> to add one. It stays only in ' + pname(key) + '.') + '</div>';
    }
    list.forEach(function (v) { html += videoCard(v, false); });
    $('view').innerHTML = html;
  }

  function mediaBox(v) {
    var busy = ui.copying && ui.copying.id === v.id ? ui.copying : null;
    var h = '';
    if (busy && busy.kind === 'video') {
      h += '<div class="media-empty" id="mediaProgress">Saving video into the app… <span>' + busy.pct + '%</span>' +
        '<div class="bar" style="margin-top:8px"><i style="width:' + busy.pct + '%"></i></div></div>';
    } else if (v.video && v.video.path) {
      h += '<video class="player" controls preload="metadata" src="' + esc(mediaSrc(v.video.path)) + '"' +
        (v.thumb && v.thumb.path ? ' poster="' + esc(mediaSrc(v.thumb.path)) + '"' : '') + '></video>' +
        '<div class="meta">' + esc(v.video.name || 'Video') + (v.video.size ? ' · ' + fmtSize(v.video.size) : '') + '</div>' +
        '<div class="row"><button class="small" data-pick="video">Change video (gallery)</button>' +
        '<button class="small ghost" data-remove="video">Remove</button></div>';
    } else {
      h += '<button class="media-empty add" data-pick="video">&#127909;<br><b>+ Add video from gallery</b><br>' +
        '<span class="meta">A copy is saved inside the app.</span></button>';
    }
    h += '<div class="thumb-row">';
    if (busy && busy.kind === 'thumb') h += '<div class="thumb none" id="mediaProgress"><span>' + busy.pct + '%</span></div>';
    else if (v.thumb && v.thumb.path) h += '<img class="thumb" alt="Thumbnail" src="' + esc(mediaSrc(v.thumb.path)) + '">';
    else h += '<div class="thumb none">No thumbnail</div>';
    h += '<div><b>Thumbnail</b><div class="row" style="margin-top:6px">' +
      '<button class="small" data-pick="thumb">' + (v.thumb ? 'Change' : '+ Add') + ' (gallery)</button>' +
      (v.thumb ? '<button class="small ghost" data-remove="thumb">Remove</button>' : '') + '</div></div></div>';
    return h;
  }

  function ytBox(v) {
    var st = ytStatus();
    var y = v.yt || {};
    var h = '<div class="section-title">Upload to YouTube</div><div class="card platform youtube">';
    if (!st.available) {
      h += '<div class="meta">YouTube upload works in the Android app.</div>';
    } else if (!st.connected) {
      h += '<p class="hint">Connect your YouTube channel once, then upload this video with its thumbnail, title, description and hashtags.</p>' +
        '<button class="primary" data-accounts="1">Connect YouTube account</button>';
    } else {
      h += '<div class="meta">Channel: <b>' + esc(st.channel || 'Connected') + '</b></div>' +
        '<label>Visibility<select data-f="privacy">' + PRIVACY.map(function (p) {
          return '<option value="' + p.k + '"' + (p.k === v.privacy ? ' selected' : '') + '>' + p.n + '</option>';
        }).join('') + '</select></label>';
      if (v.scheduledAt && new Date(v.scheduledAt).getTime() > Date.now()) {
        h += '<div class="hint">Scheduled: YouTube will publish it on ' + esc(fmtDate(v.scheduledAt)) + ' (uploaded as private until then).</div>';
      }
      var busy = y.state === 'queued' || y.state === 'uploading' || y.state === 'thumbnail';
      if (busy) {
        var label = y.state === 'queued' ? 'Starting…' : (y.state === 'thumbnail' ? 'Setting thumbnail…' : 'Uploading…');
        h += '<div class="yt-progress" id="ytProgress">' + label + ' <span>' + (y.pct || 0) + '%</span>' +
          '<div class="bar"><i style="width:' + (y.pct || 0) + '%"></i></div>' +
          '<div class="meta">You can leave this screen. Progress also shows in the notification.</div></div>';
      } else {
        if (y.state === 'done') {
          h += '<div class="ok-box">&#10003; Uploaded to YouTube' + (y.msg ? '<br><small>' + esc(y.msg) + '</small>' : '') + '</div>';
        } else if (y.state === 'error') {
          h += '<div class="err-box">Upload failed: ' + esc(y.msg) + '</div>';
        }
        h += '<button class="primary yt-btn" data-ytupload="1">&#11014; ' + (y.state === 'done' ? 'Upload again' : 'Upload to YouTube') + '</button>' +
          '<div class="meta" style="margin-top:6px">Sends: video, thumbnail, title, description + hashtags.</div>';
      }
    }
    return h + '</div>';
  }

  function renderDetail(v) {
    var k = v.platform, P = pname(k);
    $('pageTitle').textContent = v.title || P;
    var html = '<div class="card platform ' + k + '">' +
      '<div class="platform-head">' + badge(k) + '<span style="flex:1"></span>' + statusPill(v) + '</div>' + mediaBox(v) +
      '<label>' + P + ' title<input data-f="title" value="' + esc(v.title) + '" maxlength="' + (k === 'youtube' ? 100 : 300) + '"></label>' +
      '<label>' + P + ' description<textarea data-f="description" rows="5">' + esc(v.description) + '</textarea></label>' +
      '<label>' + P + ' hashtags<input data-f="hashtags" value="' + esc(v.hashtags) + '" placeholder="#tag1 #tag2"></label>' +
      '<div class="meta" style="margin-top:8px">Created ' + esc(fmtDate(v.createdAt)) + '</div></div>';

    if (k === 'youtube') html += ytBox(v);

    html += '<div class="section-title">' + P + ' upload</div><div class="card checklist">' +
      '<label class="check-row" style="border-top:0"><input type="checkbox" class="check" data-f="uploaded"' +
      (v.status === 'uploaded' ? ' checked' : '') + '><span class="dot ' + k + '"></span><span class="cr-name">Uploaded on ' + P +
      '<small>' + esc(subline(v)) + '</small></span>' + statusPill(v) + '</label>' +
      '<div class="grid2">' +
      '<label>Upload status<select data-f="status">' + STATUSES.map(function (s) {
        return '<option value="' + s.key + '"' + (s.key === v.status ? ' selected' : '') + '>' + s.name + '</option>';
      }).join('') + '</select></label>' +
      '<label>Scheduled date &amp; time<input type="datetime-local" data-f="scheduledAt" value="' + esc(v.scheduledAt) + '"></label></div>' +
      '<div class="inline"><label style="flex:1">Published video URL<input type="url" data-f="url" value="' + esc(v.url) + '" placeholder="https://"></label>' +
      '<button class="small" data-openurl="1">Open</button></div>' +
      '<div class="reminder"><label><input type="checkbox" data-f="reminder"' + (v.reminder ? ' checked' : '') + '> Reminder notification</label>' +
      '<select data-f="reminderLead"' + (v.reminder ? '' : ' disabled') + '>' + LEADS.map(function (l) {
        return '<option value="' + l.v + '"' + (l.v === Number(v.reminderLead) ? ' selected' : '') + '>' + l.name + '</option>';
      }).join('') + '</select></div>' +
      (v.reminder && !v.scheduledAt && v.status !== 'uploaded' ? '<div class="hint">Set a scheduled date &amp; time to get a reminder.</div>' : '') +
      '<div class="row"><button class="small" data-share="1">Share to ' + P + ' app</button>' +
      '<button class="small" data-copycap="1">Copy caption</button></div></div>';

    html += '<div class="row end"><button class="danger" id="deleteBtn">Delete video</button></div>';
    var y = window.scrollY;
    $('view').innerHTML = html;
    window.scrollTo(0, y);
  }

  function renderAccounts() {
    $('pageTitle').textContent = 'Connected accounts';
    var st = ytStatus();
    var html = '<div class="card platform youtube"><div class="platform-head">' + badge('youtube') + '<span style="flex:1"></span>' +
      (st.connected ? '<span class="pill uploaded">Connected</span>' : '<span class="pill">Not connected</span>') + '</div>';
    if (!st.available) {
      html += '<div class="meta">Account connection works in the Android app.</div>';
    } else if (st.connected) {
      html += '<p>Channel: <b>' + esc(st.channel || '') + '</b></p>' +
        '<div class="row"><button class="danger" data-ytdisconnect="1">Disconnect</button></div>';
    } else {
      html += '<label>Client ID<input id="ytClientId" value="' + esc(st.clientId || '') + '" placeholder="xxxx.apps.googleusercontent.com" autocapitalize="off" autocomplete="off"></label>' +
        '<label>Client secret<input id="ytClientSecret" value="' + esc(st.hasSecret ? '••••••••' : '') + '" placeholder="GOCSPX-..." autocapitalize="off" autocomplete="off"></label>' +
        '<div class="row"><button class="primary" data-ytconnect="1">Save &amp; Connect YouTube</button></div>';
    }
    html += '<details class="guide"' + (st.connected ? '' : ' open') + '><summary>Setup guide (sirf ek baar)</summary><ol>' +
      '<li>Browser mein <b>console.cloud.google.com</b> kholo. Usi Google account se login karo jisse YouTube channel bana hai.</li>' +
      '<li>Upar <b>Select project → New project</b>. Naam: <i>Faith Finance</i> → Create.</li>' +
      '<li><b>APIs &amp; Services → Library</b> mein “<b>YouTube Data API v3</b>” search karo → <b>Enable</b>.</li>' +
      '<li><b>OAuth consent screen</b> (Google Auth Platform) kholo → Get started. App name <i>Faith Finance</i>, apna email. Audience: <b>External</b>.</li>' +
      '<li><b>Audience → Test users → Add users</b> mein apna Gmail daalo. (Ya “<b>Publish app</b>” dabao, taaki login 7 din baad expire na ho.)</li>' +
      '<li><b>Clients / Credentials → Create client → OAuth client ID</b>. Application type: <b>Desktop app</b> → Create.</li>' +
      '<li>Jo <b>Client ID</b> aur <b>Client secret</b> mile, upar paste karo → <b>Save &amp; Connect</b>.</li>' +
      '<li>Google “app verified nahi hai” bole to <b>Advanced → Go to Faith Finance</b> → Continue/Allow. Login ke baad “<b>Open Faith Finance</b>” dabao.</li>' +
      '</ol><p class="warn"><b>Zaroori:</b> Google ke rule ke hisaab se naye (unverified) project se API ke through upload hui videos <b>Private par lock</b> rehti hain, jab tak project ka “YouTube API Services audit” pass na ho. Audit ke liye Google ka form bharna hota hai (free). Tab tak videos aapke channel par private aayengi.</p></details></div>';

    ['instagram', 'facebook', 'tiktok'].forEach(function (k) {
      html += '<div class="card platform ' + k + '"><div class="platform-head">' + badge(k) + '<span style="flex:1"></span><span class="pill">Coming next</span></div>' +
        '<div class="meta">Auto upload for ' + pname(k) + ' is next. For now open a video and tap “Share to ' + pname(k) + ' app”: the video opens in ' + pname(k) + ' and the caption is copied.</div></div>';
    });
    $('view').innerHTML = html;
  }

  // ---------- navigation ----------
  function openVideo(id) { ui.page = null; ui.videoId = id; window.scrollTo(0, 0); render(); }
  function closeVideo() { ui.videoId = null; ui.page = null; render(); window.scrollTo(0, 0); }
  function openAccounts() { ui.page = 'accounts'; ui.videoId = null; window.scrollTo(0, 0); render(); }

  window.handleBack = function () {
    if (!$('formModal').classList.contains('hidden')) { closeForm(); return true; }
    if (!$('modal').classList.contains('hidden')) { closeModal(); return true; }
    if (ui.videoId || ui.page) { closeVideo(); return true; }
    if (ui.tab !== 'library') { ui.tab = 'library'; render(); return true; }
    return false;
  };
  window.openReminder = function (rid) {
    var id = String(rid);
    if (!findVideo(id)) {
      var p = id.split('__'); // old reminder format
      id = p[0] + '_' + p[1];
    }
    var v = findVideo(id);
    if (v) { ui.tab = v.platform; openVideo(v.id); }
  };

  // ---------- events ----------
  $('nav').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    ui.tab = b.getAttribute('data-tab');
    ui.videoId = null;
    ui.page = null;
    render();
    window.scrollTo(0, 0);
  });
  $('backBtn').addEventListener('click', closeVideo);
  $('accountsBtn').addEventListener('click', openAccounts);

  // New video form
  function setDraftPlatform(key) {
    ui.draft.platform = key;
    var bs = document.querySelectorAll('#platformPick button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-plat') === key);
    $('newHeading').textContent = key ? 'New ' + pname(key) + ' video' : 'New video';
    $('newTitleLabel').firstChild.textContent = (key ? pname(key) + ' title' : 'Title');
  }
  // opts (optional): { platform, title, topicId } when creating a video from a plan topic
  function openModal(opts) {
    opts = opts && opts.title !== undefined ? opts : {};
    $('newTitle').value = opts.title || '';
    $('newDesc').value = '';
    $('newTags').value = '';
    ui.draft = { id: uid(), video: null, thumb: null, platform: null, topicId: opts.topicId || null };
    ui.copying = null;
    $('platformPick').innerHTML = PLATFORMS.map(function (p) {
      return '<button type="button" class="pchoice ' + p.key + '" data-plat="' + p.key + '"><span class="dot ' + p.key + '"></span>' + p.name + '</button>';
    }).join('');
    setDraftPlatform(opts.platform || (isPlatform(ui.tab) ? ui.tab : null));
    renderDraftMedia();
    $('modal').classList.remove('hidden');
  }
  function closeModal(keepMedia) {
    if (ui.draft && keepMedia !== true) {
      deleteMedia(ui.draft.video, ui.draft.id);
      deleteMedia(ui.draft.thumb, ui.draft.id);
    }
    ui.draft = null;
    ui.copying = null;
    $('modal').classList.add('hidden');
  }
  function renderDraftMedia() {
    var d = ui.draft;
    if (!d) return;
    var busy = ui.copying && ui.copying.id === d.id ? ui.copying : null;
    function row(kind, icon, label) {
      var m = d[kind];
      var state;
      if (busy && busy.kind === kind) state = '<span class="meta">Saving… ' + busy.pct + '%</span>';
      else if (m) state = '<span class="ok">&#10003; ' + esc(m.name || 'Selected') + (m.size ? ' · ' + fmtSize(m.size) : '') + '</span>';
      else state = '<span class="meta">Not selected</span>';
      var preview = kind === 'thumb' && m ? '<img class="mini" alt="" src="' + esc(mediaSrc(m.path)) + '">' : '<span class="mini-icon">' + icon + '</span>';
      return '<div class="draft-row">' + preview + '<div class="body"><b>' + label + '</b><br>' + state + '</div>' +
        '<button type="button" class="small" data-draftpick="' + kind + '">' + (m ? 'Change' : 'Gallery') + '</button></div>';
    }
    $('draftMedia').innerHTML = row('video', '&#127909;', 'Video from gallery') + row('thumb', '&#128444;', 'Thumbnail from gallery');
  }
  $('newBtn').addEventListener('click', openModal);
  $('cancelNew').addEventListener('click', function () { closeModal(); });
  $('modal').addEventListener('click', function (e) {
    if (e.target === $('modal')) { closeModal(); return; }
    var pl = e.target.closest('[data-plat]');
    if (pl && ui.draft) { setDraftPlatform(pl.getAttribute('data-plat')); return; }
    var dp = e.target.closest('[data-draftpick]');
    if (dp && ui.draft) {
      if (ui.copying) { toast('Please wait, a file is still being saved'); return; }
      pickMedia(ui.draft.id, dp.getAttribute('data-draftpick'));
    }
  });
  $('createNew').addEventListener('click', function () {
    if (ui.copying) { toast('Please wait, the file is still being saved'); return; }
    var d = ui.draft;
    if (!d.platform) { toast('Choose the platform: YouTube, Instagram, Facebook or TikTok'); return; }
    var title = $('newTitle').value.trim();
    if (!title) { toast('Please enter a title'); $('newTitle').focus(); return; }
    var v = createVideo(d.platform, title, $('newDesc').value.trim(), $('newTags').value.trim(), d);
    closeModal(true);
    toast('Added to ' + pname(v.platform) + ' and the Checklist');
    ui.tab = v.platform;
    openVideo(v.id);
  });

  var view = $('view');
  view.addEventListener('click', function (e) {
    var t = e.target;
    var filter = t.closest('[data-filter]');
    if (filter) { ui.filters[ui.tab] = filter.getAttribute('data-filter'); render(); return; }
    var go = t.closest('[data-tab-go]');
    if (go) { ui.tab = go.getAttribute('data-tab-go'); render(); window.scrollTo(0, 0); return; }
    if (t.matches('input[data-quick]')) return;
    if (t.closest('[data-accounts]')) { openAccounts(); return; }

    // Content plan
    var cm = t.closest('[data-clmode]');
    if (cm) { ui.filters.clmode = cm.getAttribute('data-clmode'); render(); return; }
    var wt = t.closest('[data-week-toggle]');
    if (wt) { var w0 = findWeek(wt.getAttribute('data-week-toggle')); w0.open = !w0.open; save(); render(); return; }
    var tc = t.closest('[data-topic-check]');
    if (tc) {
      var ft = findTopic(tc.getAttribute('data-topic-check'));
      ft.topic.done = !ft.topic.done;
      ft.topic.doneAt = ft.topic.done ? Date.now() : null;
      save();
      var pc = planCounts();
      if (ft.topic.done) toast('Day ' + (ft.index + 1) + ' done ✓ · ' + pc.done + '/' + pc.total);
      render();
      return;
    }
    var to = t.closest('[data-topic-open]');
    if (to) { topicForm(to.getAttribute('data-topic-open')); return; }
    var ta = t.closest('[data-topic-add]');
    if (ta) { addTopicsForm(findWeek(ta.getAttribute('data-topic-add'))); return; }
    var we = t.closest('[data-week-edit]');
    if (we) { editWeekForm(findWeek(we.getAttribute('data-week-edit'))); return; }
    if (t.closest('[data-week-add]')) { addWeekForm(); return; }
    var open = t.closest('[data-open]');
    if (open) { openVideo(open.getAttribute('data-open')); return; }

    // Accounts page
    if (t.closest('[data-ytconnect]')) {
      var cid = $('ytClientId').value.trim(), sec = $('ytClientSecret').value.trim();
      if (!/\.apps\.googleusercontent\.com$/.test(cid)) { toast('Paste the Client ID (ends with .apps.googleusercontent.com)'); return; }
      if (!sec) { toast('Paste the Client secret'); return; }
      native.ytSaveConfig(cid, sec === '••••••••' ? '' : sec);
      native.ytConnect();
      toast('Opening Google sign-in…');
      return;
    }
    if (t.closest('[data-ytdisconnect]')) {
      if (confirm('Disconnect your YouTube account from this app?')) { native.ytDisconnect(); render(); }
      return;
    }

    var cur = findVideo(ui.videoId);
    if (!cur) return;
    var pk = t.closest('[data-pick]');
    if (pk) {
      if (ui.copying) { toast('Please wait, a file is still being saved'); return; }
      pickMedia(cur.id, pk.getAttribute('data-pick'));
      return;
    }
    var rm = t.closest('[data-remove]');
    if (rm) {
      var f = rm.getAttribute('data-remove');
      if (confirm(f === 'video' ? 'Remove this video file from the app?' : 'Remove the thumbnail?')) {
        var m = cur[f];
        cur[f] = null;
        deleteMedia(m, cur.id);
        save();
        render();
      }
      return;
    }
    if (t.closest('[data-ytupload]')) { startYtUpload(cur); return; }
    if (t.closest('[data-share]')) {
      if (!cur.video || !cur.video.path) { toast('Add the video file first'); return; }
      if (native) native.shareVideo(cur.video.path, cur.platform, caption(cur));
      else toast('Sharing works in the Android app');
      return;
    }
    if (t.closest('[data-copycap]')) { copyText(caption(cur)); return; }
    if (t.closest('[data-openurl]')) {
      var url = (cur.url || '').trim();
      if (!url) { toast('Add the published URL first'); return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (native) native.openUrl(url); else window.open(url, '_blank');
      return;
    }
    if (t.id === 'deleteBtn') {
      if (confirm('Delete "' + cur.title + '" from ' + pname(cur.platform) + '?')) {
        if (native) native.cancelReminder(cur.id);
        data.videos = data.videos.filter(function (x) { return x.id !== cur.id; });
        deleteMedia(cur.video, cur.id);
        deleteMedia(cur.thumb, cur.id);
        save();
        closeVideo();
        toast('Video deleted');
      }
    }
  });

  view.addEventListener('input', function (e) {
    var t = e.target, v = findVideo(ui.videoId);
    if (!v) return;
    var f = t.getAttribute('data-f');
    if (f === 'title' || f === 'description' || f === 'hashtags' || f === 'url') {
      v[f] = t.value;
      if (f === 'title') $('pageTitle').textContent = t.value || pname(v.platform);
      saveSoon();
    }
  });

  view.addEventListener('change', function (e) {
    var t = e.target;
    var qid = t.getAttribute('data-quick');
    if (qid) {
      var qv = findVideo(qid);
      setUploaded(qv, t.checked);
      toast((t.checked ? 'Uploaded on ' : 'Marked not uploaded on ') + pname(qv.platform));
      render();
      return;
    }
    var v = findVideo(ui.videoId);
    if (!v) return;
    var f = t.getAttribute('data-f');
    if (!f) return;
    if (f === 'uploaded') {
      setUploaded(v, t.checked);
      toast((t.checked ? 'Uploaded on ' : 'Marked not uploaded on ') + pname(v.platform));
    } else if (f === 'status') {
      if (t.value === 'uploaded') setUploaded(v, true);
      else { v.status = t.value; v.uploadedAt = null; }
    } else if (f === 'scheduledAt') {
      v.scheduledAt = t.value;
      if (t.value && v.status === 'pending') v.status = 'scheduled';
      if (!t.value && v.status === 'scheduled') v.status = 'pending';
    } else if (f === 'reminder') {
      v.reminder = t.checked;
    } else if (f === 'reminderLead') {
      v.reminderLead = Number(t.value);
    } else {
      v[f] = t.value;
    }
    save();
    syncReminder(v);
    render();
  });

  setInterval(function () {
    var a = document.activeElement;
    if (ui.videoId || ui.page) return;
    if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) render();
  }, 60000);

  window.onAppResume = function () {
    var a = document.activeElement;
    syncYtJobs();
    if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) render();
  };

  syncYtJobs();
  render();
  data.videos.forEach(syncReminder);
})();
