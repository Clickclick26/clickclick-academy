/**
 * Course Manager (admin.html) — local-only convenience tool.
 * Loads courses.json + packs.json, lets you add/edit a course and choose its packs
 * through a form, then hands back downloadable, correctly-shaped JSON files.
 * It never writes to disk itself — you still move the files in and `git push`.
 */
(function () {
  var AUDIENCES = [
    { value: 'corporate', label: 'Corporate' },
    { value: 'agency', label: 'Agency' },
    { value: 'creator', label: 'Creator' },
    { value: 'staff', label: 'Staff' },
    { value: 'live-host', label: 'Live host' },
    { value: 'internal', label: 'Internal' },
  ];

  var ICONS = ['▶', '☑', '◎', '✦', '↑', '✂', '★', '◈', '☎', '●'];

  var TONES = ['#d8f3f7', '#ebe4f5', '#fff0d8', '#f3e8ff', '#e4f7ea', '#fde8f1'];

  var allCourses = [];
  var packsByCode = {};
  var editingId = null; // id of the course currently loaded into the form, or null for "new"
  var dirty = false; // true once the in-memory data differs from what's on disk

  var els = {
    title: document.getElementById('f-title'),
    id: document.getElementById('f-id'),
    desc: document.getElementById('f-desc'),
    tag: document.getElementById('f-tag'),
    lessons: document.getElementById('f-lessons'),
    level: document.getElementById('f-level'),
    status: document.getElementById('f-status'),
    highlight: document.getElementById('f-highlight'),
    link: document.getElementById('f-link'),
    audienceChecks: document.getElementById('audience-checks'),
    iconPick: document.getElementById('icon-pick'),
    toneSwatches: document.getElementById('tone-swatches'),
    packChecks: document.getElementById('pack-checks'),
    formTitle: document.getElementById('form-title'),
    formStatus: document.getElementById('form-status'),
    previewSlot: document.getElementById('preview-slot'),
    existingList: document.getElementById('existing-list'),
    btnSave: document.getElementById('btn-save'),
    btnReset: document.getElementById('btn-reset'),
    btnDownloadCourses: document.getElementById('btn-download-courses'),
    btnDownloadPacks: document.getElementById('btn-download-packs'),
    pendingFlag: document.getElementById('pending-flag'),
  };

  var selectedIcon = ICONS[0];
  var selectedTone = TONES[0];
  var idTouchedByUser = false;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function uniqueId(base, ignoreId) {
    var existing = allCourses.map(function (c) { return c.id; });
    if (base && (!existing.includes(base) || base === ignoreId)) return base;
    var i = 2;
    while (existing.includes(base + '-' + i) && base + '-' + i !== ignoreId) i++;
    return (base || 'course') + '-' + i;
  }

  function setStatus(msg, kind) {
    els.formStatus.textContent = msg || '';
    els.formStatus.className = 'status-msg' + (kind ? ' ' + kind : '');
  }

  function markDirty() {
    dirty = true;
    els.btnDownloadCourses.disabled = false;
    els.btnDownloadPacks.disabled = false;
    els.pendingFlag.hidden = false;
  }

  function buildChecks(container, items, name) {
    container.innerHTML = '';
    items.forEach(function (item) {
      var id = name + '-' + item.value;
      var label = document.createElement('label');
      label.className = 'check-pill';
      label.innerHTML =
        '<input type="checkbox" id="' + id + '" value="' + esc(item.value) + '" />' + esc(item.label);
      container.appendChild(label);
    });
  }

  function buildIconPicker() {
    els.iconPick.innerHTML = '';
    ICONS.forEach(function (icon) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn' + (icon === selectedIcon ? ' is-selected' : '');
      btn.textContent = icon;
      btn.addEventListener('click', function () {
        selectedIcon = icon;
        buildIconPicker();
        renderPreview();
      });
      els.iconPick.appendChild(btn);
    });
  }

  function buildToneSwatches() {
    els.toneSwatches.innerHTML = '';
    TONES.forEach(function (tone) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (tone === selectedTone ? ' is-selected' : '');
      btn.style.background = tone;
      btn.title = tone;
      btn.addEventListener('click', function () {
        selectedTone = tone;
        buildToneSwatches();
        renderPreview();
      });
      els.toneSwatches.appendChild(btn);
    });
  }

  function buildPackChecks() {
    var items = Object.keys(packsByCode).map(function (code) {
      return { value: code, label: packsByCode[code].label || code };
    });
    buildChecks(els.packChecks, items, 'pack');
  }

  function checkedValues(container) {
    return Array.prototype.slice
      .call(container.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (el) { return el.value; });
  }

  function setChecked(container, values) {
    var set = {};
    (values || []).forEach(function (v) { set[v] = true; });
    Array.prototype.forEach.call(container.querySelectorAll('input[type="checkbox"]'), function (el) {
      el.checked = !!set[el.value];
    });
  }

  function courseFromForm() {
    var title = els.title.value.trim();
    var rawId = els.id.value.trim() || slugify(title);
    var id = uniqueId(slugify(rawId), editingId);
    var lessons = Math.max(1, parseInt(els.lessons.value, 10) || 1);
    var course = {
      id: id,
      title: title,
      description: els.desc.value.trim(),
      tag: els.tag.value.trim(),
      audience: checkedValues(els.audienceChecks),
      lessons: lessons,
      level: els.level.value.trim() || 'Core',
      status: els.status.value.trim() || 'Not started',
      icon: selectedIcon,
      tone: selectedTone,
    };
    if (els.highlight.checked) course.statusClass = 'is-coach';
    var link = els.link.value.trim();
    if (link) course.href = link;
    return course;
  }

  function cardHtml(course) {
    var statusClass = course.statusClass ? ' status ' + course.statusClass : ' status';
    var lessons = Number(course.lessons) || 0;
    return (
      '<article class="course-card">' +
      '<div class="course-visual" style="background:' + esc(course.tone || '#ebe4f5') + '">' +
      '<span class="course-lessons">' + lessons + (lessons === 1 ? ' lesson' : ' lessons') + '</span>' +
      '<span class="course-icon" aria-hidden="true">' + esc(course.icon || '▶') + '</span>' +
      '</div>' +
      '<div class="course-body">' +
      '<span class="course-tag">' + esc(course.tag || '') + '</span>' +
      '<h3>' + esc(course.title || 'Untitled course') + '</h3>' +
      (course.description ? '<p class="course-desc">' + esc(course.description) + '</p>' : '') +
      '<div class="course-meta">' +
      '<span>Level: ' + esc(course.level || '') + '</span>' +
      '<span class="' + statusClass.trim() + '">' + esc(course.status || 'Not started') + '</span>' +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  function renderPreview() {
    els.previewSlot.innerHTML = cardHtml(courseFromForm());
  }

  function renderExisting() {
    els.existingList.innerHTML = '';
    allCourses.forEach(function (course) {
      var row = document.createElement('div');
      row.className = 'existing-row';
      row.innerHTML =
        '<span>' + esc(course.title || course.id) + '</span><button type="button">Edit</button>';
      row.querySelector('button').addEventListener('click', function () {
        loadCourseIntoForm(course);
      });
      els.existingList.appendChild(row);
    });
  }

  function packsForCourse(id) {
    return Object.keys(packsByCode).filter(function (code) {
      return (packsByCode[code].courseIds || []).includes(id);
    });
  }

  function loadCourseIntoForm(course) {
    editingId = course.id;
    idTouchedByUser = true;
    els.formTitle.textContent = 'Editing: ' + (course.title || course.id);
    els.title.value = course.title || '';
    els.id.value = course.id;
    els.id.disabled = true;
    els.desc.value = course.description || '';
    els.tag.value = course.tag || '';
    els.lessons.value = course.lessons || 1;
    els.level.value = course.level || 'Core';
    els.status.value = course.status || 'Not started';
    els.highlight.checked = course.statusClass === 'is-coach';
    els.link.value = course.href || '';
    selectedIcon = course.icon || ICONS[0];
    selectedTone = course.tone || TONES[0];
    buildIconPicker();
    buildToneSwatches();
    setChecked(els.audienceChecks, course.audience || []);
    setChecked(els.packChecks, packsForCourse(course.id));
    els.btnSave.textContent = 'Save changes';
    setStatus('Editing "' + (course.title || course.id) + '" — ID is locked so packs keep working.', '');
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    editingId = null;
    idTouchedByUser = false;
    els.formTitle.textContent = 'New course';
    els.title.value = '';
    els.id.value = '';
    els.id.disabled = false;
    els.desc.value = '';
    els.tag.value = '';
    els.lessons.value = 3;
    els.level.value = 'Core';
    els.status.value = 'Not started';
    els.highlight.checked = false;
    els.link.value = '';
    selectedIcon = ICONS[0];
    selectedTone = TONES[0];
    buildIconPicker();
    buildToneSwatches();
    setChecked(els.audienceChecks, []);
    setChecked(els.packChecks, []);
    els.btnSave.textContent = 'Add course';
    setStatus('');
    renderPreview();
    els.title.focus();
  }

  function download(filename, data) {
    var blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function saveCourse() {
    var title = els.title.value.trim();
    if (!title) {
      setStatus('Give the course a title first.', 'warn');
      return;
    }
    var course = courseFromForm();
    var packCodes = checkedValues(els.packChecks);
    if (packCodes.length === 0) {
      setStatus('No packs selected — this course won’t show up for anyone yet. Saved anyway.', 'warn');
    }

    var existingIndex = allCourses.findIndex(function (c) { return c.id === course.id; });
    if (existingIndex >= 0) {
      allCourses[existingIndex] = course;
    } else {
      allCourses.push(course);
    }

    // Sync pack membership: add to checked packs, remove from unchecked ones.
    Object.keys(packsByCode).forEach(function (code) {
      var ids = packsByCode[code].courseIds || [];
      var has = ids.includes(course.id);
      var wants = packCodes.includes(code);
      if (wants && !has) ids.push(course.id);
      if (!wants && has) ids = ids.filter(function (id) { return id !== course.id; });
      packsByCode[code].courseIds = ids;
    });

    markDirty();
    renderExisting();
    resetForm();
    setStatus(
      packCodes.length > 0
        ? 'Saved "' + course.title + '". Download both files below when you’re done.'
        : 'Saved "' + course.title + '" — but it\'s in no packs yet, so no one will see it.',
      packCodes.length > 0 ? 'ok' : 'warn',
    )
  }

  function boot() {
    buildChecks(els.audienceChecks, AUDIENCES, 'aud');
    buildIconPicker();
    buildToneSwatches();
    renderPreview();

    els.title.addEventListener('input', function () {
      if (!idTouchedByUser) els.id.value = slugify(els.title.value);
      renderPreview();
    });
    els.id.addEventListener('input', function () { idTouchedByUser = true; });
    [els.desc, els.tag, els.lessons, els.level, els.status, els.link].forEach(function (el) {
      el.addEventListener('input', renderPreview);
    });
    els.highlight.addEventListener('change', renderPreview);
    els.audienceChecks.addEventListener('change', renderPreview);

    els.btnSave.addEventListener('click', saveCourse);
    els.btnReset.addEventListener('click', resetForm);
    els.btnDownloadCourses.addEventListener('click', function () {
      download('courses.json', allCourses);
    });
    els.btnDownloadPacks.addEventListener('click', function () {
      download('packs.json', packsByCode);
    });

    Promise.all([
      fetch('courses.json', { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch('packs.json', { cache: 'no-store' }).then(function (r) { return r.json(); }),
    ])
      .then(function (pair) {
        allCourses = Array.isArray(pair[0]) ? pair[0] : [];
        packsByCode = pair[1] && typeof pair[1] === 'object' ? pair[1] : {};
        buildPackChecks();
        renderExisting();
      })
      .catch(function () {
        setStatus('Could not load courses.json / packs.json. Run this from the project folder (see README).', 'warn');
      });
  }

  boot();
})();
