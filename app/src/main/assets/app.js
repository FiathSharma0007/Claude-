/* VideoHub: one shared video library, tracked separately on 4 platforms. */
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

  var native = window.Android || null;
  var data = load();
  var ui = { tab: 'library', videoId: null, focus: null, filters: {} };

  // ---------- storage ----------
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.videos)) {
          d.videos.forEach(ensurePlatforms);
          return d;
        }
      }
    } catch (e) { /* ignore */ }
    return { videos: [] };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { toast('Could not save'); }
  }
  var saveTimer = null;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }

  // ---------- model ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function newPlatformEntry(v) {
    return {
      status: 'pending',
      scheduledAt: '',
      title: v.title,
      description: v.description,
      hashtags: v.hashtags,
      url: '',
      reminder: true,
      reminderLead: 30,
      uploadedAt: null
    };
  }

  // Every video has exactly one entry per platform, inside the single video record.
  function ensurePlatforms(v) {
    v.platforms = v.platforms || {};
    PLATFORMS.forEach(function (p) {
      if (!v.platforms[p.key]) v.platforms[p.key] = newPlatformEntry(v);
    });
  }

  function createVideo(title, description, hashtags) {
    var v = {
      id: uid(),
      title: title,
      description: description,
      hashtags: hashtags,
      createdAt: Date.now()
    };
    ensurePlatforms(v);
    data.videos.push(v);
    save();
    return v;
  }

  function findVideo(id) {
    for (var i = 0; i < data.videos.length; i++) if (data.videos[i].id === id) return data.videos[i];
    return null;
  }

  function doneCount(v) {
    return PLATFORMS.filter(function (p) { return v.platforms[p.key].status === 'uploaded'; }).length;
  }

  function isOverdue(pe) {
    if (pe.status === 'uploaded' || !pe.scheduledAt) return false;
    return new Date(pe.scheduledAt).getTime() < Date.now();
  }

  function platformName(key) {
    for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].key === key) return PLATFORMS[i].name;
    return key;
  }

  // Marks ONE platform uploaded / not uploaded. Other platforms are untouched.
  function setUploaded(v, key, uploaded) {
    var pe = v.platforms[key];
    if (uploaded) {
      pe.status = 'uploaded';
      pe.uploadedAt = Date.now();
    } else {
      pe.status = pe.scheduledAt ? 'scheduled' : 'pending';
      pe.uploadedAt = null;
    }
    save();
    syncReminder(v, key);
  }

  // ---------- reminders ----------
  function reminderId(v, key) { return v.id + '__' + key; }

  function syncReminder(v, key) {
    if (!native) return;
    var pe = v.platforms[key];
    var id = reminderId(v, key);
    var at = pe.scheduledAt ? new Date(pe.scheduledAt).getTime() - (pe.reminderLead || 0) * 60000 : NaN;
    if (pe.reminder && pe.status !== 'uploaded' && !isNaN(at) && at > Date.now()) {
      var t = pe.title || v.title;
      native.scheduleReminder(id, at,
        'Upload reminder · ' + platformName(key),
        '"' + t + '" is scheduled for ' + platformName(key) + ' at ' + fmtDate(pe.scheduledAt) + '.');
    } else {
      native.cancelReminder(id);
    }
  }
  function syncAllReminders() {
    data.videos.forEach(function (v) { PLATFORMS.forEach(function (p) { syncReminder(v, p.key); }); });
  }
  function cancelAllReminders(v) {
    if (!native) return;
    PLATFORMS.forEach(function (p) { native.cancelReminder(reminderId(v, p.key)); });
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
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }
  function $(id) { return document.getElementById(id); }

  function statusPill(pe) {
    if (isOverdue(pe)) return '<span class="pill overdue">Overdue</span>';
    var name = STATUSES.filter(function (s) { return s.key === pe.status; })[0];
    return '<span class="pill ' + pe.status + '">' + esc(name ? name.name : pe.status) + '</span>';
  }

  function progressBar(v) {
    var n = doneCount(v);
    return '<div class="progress"><div class="bar"><i style="width:' + (n / PLATFORMS.length * 100) +
      '%"></i></div><b>' + n + '/' + PLATFORMS.length + ' platforms completed</b></div>';
  }

  function chips(tabKey, options) {
    var cur = ui.filters[tabKey] || 'all';
    return '<div class="chips">' + options.map(function (o) {
      return '<button class="chip' + (o.k === cur ? ' active' : '') + '" data-filter="' + o.k + '">' + esc(o.n) + '</button>';
    }).join('') + '</div>';
  }

  // ---------- views ----------
  function render() {
    var nav = document.querySelectorAll('#nav button');
    for (var i = 0; i < nav.length; i++) nav[i].classList.toggle('active', nav[i].getAttribute('data-tab') === ui.tab);

    $('backBtn').classList.toggle('hidden', !ui.videoId);
    $('newBtn').classList.toggle('hidden', !!ui.videoId);

    if (ui.videoId && findVideo(ui.videoId)) return renderDetail(findVideo(ui.videoId));
    ui.videoId = null;
    if (ui.tab === 'library') return renderLibrary();
    return renderPlatform(ui.tab);
  }

  function renderLibrary() {
    $('pageTitle').textContent = 'Content Library';
    var vids = data.videos.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var total = vids.length;
    var complete = vids.filter(function (v) { return doneCount(v) === PLATFORMS.length; }).length;
    var f = ui.filters.library || 'all';
    if (f === 'pending') vids = vids.filter(function (v) { return doneCount(v) < PLATFORMS.length; });
    if (f === 'done') vids = vids.filter(function (v) { return doneCount(v) === PLATFORMS.length; });

    var html = '<div class="summary">' +
      '<div class="stat"><b>' + total + '</b><span>Videos</span></div>' +
      '<div class="stat"><b>' + (total - complete) + '</b><span>In progress</span></div>' +
      '<div class="stat"><b>' + complete + '</b><span>All 4 done</span></div></div>';
    html += chips('library', [{ k: 'all', n: 'All' }, { k: 'pending', n: 'In progress' }, { k: 'done', n: 'Completed' }]);

    if (!vids.length) {
      html += '<div class="empty">' + (total ? 'No videos in this filter.' :
        'No videos yet.<br>Tap <b>+ New Video</b>. Each video is created once and shows up on all 4 platforms.') + '</div>';
    }
    vids.forEach(function (v) {
      html += '<div class="card tap" data-open="' + v.id + '"><h3>' + esc(v.title) + '</h3>' +
        '<div class="meta">Created ' + esc(fmtDate(v.createdAt)) + '</div>' + progressBar(v) + '<div class="pills">' +
        PLATFORMS.map(function (p) {
          var pe = v.platforms[p.key];
          var cls = isOverdue(pe) ? 'overdue' : pe.status;
          var mark = pe.status === 'uploaded' ? '&#10003;' : (isOverdue(pe) ? '!' : '&#8226;');
          return '<span class="pill ' + cls + '"><span class="dot ' + p.key + '"></span>' + p.name + ' ' + mark + '</span>';
        }).join('') + '</div></div>';
    });
    $('view').innerHTML = html;
  }

  function renderPlatform(key) {
    $('pageTitle').textContent = platformName(key);
    var vids = data.videos.slice();
    var counts = { pending: 0, scheduled: 0, uploaded: 0 };
    vids.forEach(function (v) {
      var s = v.platforms[key].status;
      if (s === 'uploaded') counts.uploaded++;
      else if (s === 'scheduled') counts.scheduled++;
      else counts.pending++;
    });
    var f = ui.filters[key] || 'all';
    if (f === 'todo') vids = vids.filter(function (v) { return v.platforms[key].status !== 'uploaded'; });
    if (f === 'uploaded') vids = vids.filter(function (v) { return v.platforms[key].status === 'uploaded'; });
    vids.sort(function (a, b) {
      var pa = a.platforms[key], pb = b.platforms[key];
      var ua = pa.status === 'uploaded' ? 1 : 0, ub = pb.status === 'uploaded' ? 1 : 0;
      if (ua !== ub) return ua - ub;
      var ta = pa.scheduledAt ? new Date(pa.scheduledAt).getTime() : Infinity;
      var tb = pb.scheduledAt ? new Date(pb.scheduledAt).getTime() : Infinity;
      if (ta !== tb) return ta - tb;
      return b.createdAt - a.createdAt;
    });

    var html = '<div class="summary">' +
      '<div class="stat"><b>' + counts.pending + '</b><span>Pending</span></div>' +
      '<div class="stat"><b>' + counts.scheduled + '</b><span>Scheduled</span></div>' +
      '<div class="stat"><b>' + counts.uploaded + '</b><span>Uploaded</span></div></div>';
    html += chips(key, [{ k: 'all', n: 'All' }, { k: 'todo', n: 'Not uploaded' }, { k: 'uploaded', n: 'Uploaded' }]);

    if (!vids.length) {
      html += '<div class="empty">' + (data.videos.length ? 'Nothing in this filter.' :
        'No videos yet. Videos you create in the library show up here automatically.') + '</div>';
    }
    vids.forEach(function (v) {
      var pe = v.platforms[key];
      var sub = pe.status === 'uploaded'
        ? 'Uploaded ' + fmtDate(pe.uploadedAt)
        : (pe.scheduledAt ? 'Scheduled ' + fmtDate(pe.scheduledAt) : 'Not scheduled');
      html += '<div class="card platform ' + key + '"><div class="prow">' +
        '<input type="checkbox" class="check" data-quick="' + v.id + '" data-p="' + key + '"' +
        (pe.status === 'uploaded' ? ' checked' : '') + ' aria-label="Uploaded on ' + platformName(key) + '">' +
        '<div class="body tap" data-open="' + v.id + '" data-focus="' + key + '">' +
        '<h3>' + esc(pe.title || v.title) + '</h3>' +
        '<div class="meta">' + esc(sub) + (pe.reminder && pe.scheduledAt && pe.status !== 'uploaded' ? ' · &#128276;' : '') + '</div>' +
        '<div class="pills">' + statusPill(pe) + '<span class="pill">' + doneCount(v) + '/' + PLATFORMS.length + ' platforms</span></div>' +
        '</div></div></div>';
    });
    $('view').innerHTML = html;
  }

  function renderDetail(v) {
    $('pageTitle').textContent = v.title;
    var html = '<div class="card">' +
      '<div class="section-title" style="margin-top:0">Main video (shared)</div>' +
      '<label>Title<input data-main="title" value="' + esc(v.title) + '" maxlength="200"></label>' +
      '<label>Description<textarea data-main="description" rows="3">' + esc(v.description) + '</textarea></label>' +
      '<label>Hashtags<input data-main="hashtags" value="' + esc(v.hashtags) + '"></label>' +
      '<div class="meta" style="margin-top:8px">Created ' + esc(fmtDate(v.createdAt)) + '</div>' +
      progressBar(v) + '</div>';

    html += '<div class="section-title">Platforms</div>';
    PLATFORMS.forEach(function (p) {
      var pe = v.platforms[p.key];
      var k = p.key;
      html += '<div class="card platform ' + k + '" id="pc-' + k + '">' +
        '<div class="platform-head"><span class="dot ' + k + '"></span><h3>' + p.name + '</h3>' + statusPill(pe) + '</div>' +
        '<label class="uploaded-toggle"><input type="checkbox" class="check" data-p="' + k + '" data-f="uploaded"' +
        (pe.status === 'uploaded' ? ' checked' : '') + '> Uploaded on ' + p.name + '</label>' +
        (pe.uploadedAt ? '<div class="meta">Marked uploaded ' + esc(fmtDate(pe.uploadedAt)) + '</div>' : '') +
        '<div class="grid2">' +
        '<label>Upload status<select data-p="' + k + '" data-f="status">' +
        STATUSES.map(function (s) {
          return '<option value="' + s.key + '"' + (s.key === pe.status ? ' selected' : '') + '>' + s.name + '</option>';
        }).join('') + '</select></label>' +
        '<label>Scheduled date &amp; time<input type="datetime-local" data-p="' + k + '" data-f="scheduledAt" value="' + esc(pe.scheduledAt) + '"></label>' +
        '</div>' +
        '<label>' + p.name + ' title<input data-p="' + k + '" data-f="title" value="' + esc(pe.title) + '" placeholder="' + esc(v.title) + '"></label>' +
        '<label>' + p.name + ' description<textarea rows="3" data-p="' + k + '" data-f="description">' + esc(pe.description) + '</textarea></label>' +
        '<label>' + p.name + ' hashtags<input data-p="' + k + '" data-f="hashtags" value="' + esc(pe.hashtags) + '"></label>' +
        '<div class="inline"><label style="flex:1">Published video URL<input type="url" data-p="' + k + '" data-f="url" value="' + esc(pe.url) + '" placeholder="https://"></label>' +
        '<button class="small" data-openurl="' + k + '">Open</button></div>' +
        '<div class="reminder"><label><input type="checkbox" data-p="' + k + '" data-f="reminder"' + (pe.reminder ? ' checked' : '') + '> Reminder notification</label>' +
        '<select data-p="' + k + '" data-f="reminderLead"' + (pe.reminder ? '' : ' disabled') + '>' +
        LEADS.map(function (l) {
          return '<option value="' + l.v + '"' + (l.v === Number(pe.reminderLead) ? ' selected' : '') + '>' + l.name + '</option>';
        }).join('') + '</select></div>' +
        (pe.reminder && !pe.scheduledAt && pe.status !== 'uploaded' ? '<div class="hint">Set a scheduled date &amp; time to get a reminder.</div>' : '') +
        '</div>';
    });

    html += '<div class="row end"><button class="danger" id="deleteBtn">Delete video</button></div>';
    var y = window.scrollY;
    $('view').innerHTML = html;
    if (ui.focus) {
      var el = $('pc-' + ui.focus);
      ui.focus = null;
      if (el) el.scrollIntoView();
    } else {
      window.scrollTo(0, y);
    }
  }

  // ---------- navigation ----------
  function openVideo(id, focus) {
    ui.videoId = id;
    ui.focus = focus || null;
    window.scrollTo(0, 0);
    render();
  }
  function closeVideo() {
    ui.videoId = null;
    render();
    window.scrollTo(0, 0);
  }

  window.handleBack = function () {
    if (!$('modal').classList.contains('hidden')) { closeModal(); return true; }
    if (ui.videoId) { closeVideo(); return true; }
    if (ui.tab !== 'library') { ui.tab = 'library'; render(); return true; }
    return false;
  };

  window.openReminder = function (rid) {
    var parts = String(rid).split('__');
    if (findVideo(parts[0])) {
      if (parts[1]) ui.tab = parts[1];
      openVideo(parts[0], parts[1]);
    }
  };

  // ---------- events ----------
  $('nav').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    ui.tab = b.getAttribute('data-tab');
    ui.videoId = null;
    render();
    window.scrollTo(0, 0);
  });

  $('backBtn').addEventListener('click', closeVideo);

  function openModal() {
    $('newTitle').value = '';
    $('newDesc').value = '';
    $('newTags').value = '';
    $('modal').classList.remove('hidden');
    $('newTitle').focus();
  }
  function closeModal() { $('modal').classList.add('hidden'); }
  $('newBtn').addEventListener('click', openModal);
  $('cancelNew').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
  $('createNew').addEventListener('click', function () {
    var title = $('newTitle').value.trim();
    if (!title) { toast('Please enter a title'); $('newTitle').focus(); return; }
    var v = createVideo(title, $('newDesc').value.trim(), $('newTags').value.trim());
    closeModal();
    toast('Video added to YouTube, Instagram, Facebook & TikTok');
    openVideo(v.id);
  });

  var view = $('view');

  view.addEventListener('click', function (e) {
    var t = e.target;
    var filter = t.closest('[data-filter]');
    if (filter) {
      ui.filters[ui.tab] = filter.getAttribute('data-filter');
      render();
      return;
    }
    if (t.matches('input[data-quick]')) return; // handled in change
    var open = t.closest('[data-open]');
    if (open) { openVideo(open.getAttribute('data-open'), open.getAttribute('data-focus')); return; }

    var ou = t.closest('[data-openurl]');
    if (ou) {
      var v = findVideo(ui.videoId);
      var url = v && v.platforms[ou.getAttribute('data-openurl')].url.trim();
      if (!url) { toast('Add the published URL first'); return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (native) native.openUrl(url); else window.open(url, '_blank');
      return;
    }
    if (t.id === 'deleteBtn') {
      var dv = findVideo(ui.videoId);
      if (dv && confirm('Delete "' + dv.title + '" from the library and all 4 platforms?')) {
        cancelAllReminders(dv);
        data.videos = data.videos.filter(function (x) { return x.id !== dv.id; });
        save();
        closeVideo();
        toast('Video deleted');
      }
    }
  });

  // Text typing: save without re-rendering (keeps focus / cursor).
  view.addEventListener('input', function (e) {
    var t = e.target;
    var v = findVideo(ui.videoId);
    if (!v) return;
    var main = t.getAttribute('data-main');
    if (main) {
      v[main] = t.value;
      if (main === 'title') $('pageTitle').textContent = t.value;
      saveSoon();
      return;
    }
    var key = t.getAttribute('data-p'), f = t.getAttribute('data-f');
    if (key && (f === 'title' || f === 'description' || f === 'hashtags' || f === 'url')) {
      v.platforms[key][f] = t.value;
      saveSoon();
    }
  });

  view.addEventListener('change', function (e) {
    var t = e.target;

    // Quick checkbox in a platform list
    var qid = t.getAttribute('data-quick');
    if (qid) {
      var qv = findVideo(qid);
      var qk = t.getAttribute('data-p');
      setUploaded(qv, qk, t.checked);
      toast((t.checked ? 'Uploaded on ' : 'Marked pending on ') + platformName(qk) + ' · ' + doneCount(qv) + '/4 done');
      render();
      return;
    }

    var v = findVideo(ui.videoId);
    if (!v) return;
    if (t.getAttribute('data-main')) { save(); render(); return; }
    var key = t.getAttribute('data-p'), f = t.getAttribute('data-f');
    if (!key || !f) return;
    var pe = v.platforms[key];

    if (f === 'uploaded') {
      setUploaded(v, key, t.checked);
      toast((t.checked ? 'Uploaded on ' : 'Marked pending on ') + platformName(key) + ' · ' + doneCount(v) + '/4 done');
    } else if (f === 'status') {
      if (t.value === 'uploaded') setUploaded(v, key, true);
      else { pe.status = t.value; pe.uploadedAt = null; }
    } else if (f === 'scheduledAt') {
      pe.scheduledAt = t.value;
      if (t.value && pe.status === 'pending') pe.status = 'scheduled';
      if (!t.value && pe.status === 'scheduled') pe.status = 'pending';
    } else if (f === 'reminder') {
      pe.reminder = t.checked;
    } else if (f === 'reminderLead') {
      pe.reminderLead = Number(t.value);
    } else {
      pe[f] = t.value;
    }
    save();
    syncReminder(v, key);
    render();
  });

  // Re-render periodically so "Overdue" badges stay current.
  setInterval(function () {
    var a = document.activeElement;
    if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) render();
  }, 60000);

  render();
  syncAllReminders();
})();
