/**
 * Editor for the creator portfolio page, included with Certification + Priority.
 *
 * The page it edits is rendered on clickclick.video, not here. This file only
 * collects the content and hands it to the academy-progress edge function,
 * which is the only thing that can write to the table or the bucket. The
 * entitlement check is the server's too: this page hides the editor when the
 * server says no, but hiding is decoration, the refusal is what counts.
 */
(function () {
  var ACADEMY_API =
    'https://gapybapywpdogexibtgj.supabase.co/functions/v1/academy-progress';
  var ACADEMY_ANON_KEY = 'sb_publishable_H6AqSkDWFjR42ff7YE1MIw_-qU2z0OT';
  var SUPABASE_URL = 'https://gapybapywpdogexibtgj.supabase.co';
  var STUDENT_KEY = 'clickclick_academy_student_v1';
  var PUBLIC_BASE = 'https://www.clickclick.video/creators/p/?c=';
  var MAX_WORKS = 8;
  var MAX_FILE_BYTES = 25 * 1024 * 1024;

  var THEMES = [
    { id: 'ink', name: 'Ink', swatch: '#14130f' },
    { id: 'sand', name: 'Sand', swatch: '#efe9da' },
    { id: 'mono', name: 'Mono', swatch: '#ffffff' },
    { id: 'signal', name: 'Signal', swatch: '#1c1f3b' }
  ];
  var ACCENTS = ['#d9f125', '#ff6b4a', '#4a7dff', '#12b886', '#ffffff', '#111111'];

  function api(payload) {
    return fetch(ACADEMY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ACADEMY_ANON_KEY,
        Authorization: 'Bearer ' + ACADEMY_ANON_KEY
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var err = new Error((data && data.error) || 'Request failed');
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function $(id) { return document.getElementById(id); }

  function loadStudent() {
    try {
      var raw = localStorage.getItem(STUDENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  var student = loadStudent();
  var storageBase = SUPABASE_URL + '/storage/v1/object/public/creator-portfolios/';
  var state = {
    slug: '',
    slugLocked: false,
    published: false,
    theme: 'ink',
    accent: '#d9f125',
    avatar: '',
    works: []
  };

  function show(id) {
    ['pf-loading', 'pf-nosession', 'pf-locked', 'pf-editor'].forEach(function (key) {
      var el = $(key);
      if (el) el.hidden = key !== id;
    });
  }

  function setError(message) {
    var el = $('pf-error');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = message;
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function flashSaved(text) {
    var el = $('pf-saved');
    if (!el) return;
    el.textContent = text || 'Saved';
    el.hidden = false;
    clearTimeout(flashSaved.timer);
    flashSaved.timer = setTimeout(function () { el.hidden = true; }, 2500);
  }

  // --- the look choices ----------------------------------------------------

  function renderThemes() {
    var row = $('pf-themes');
    if (!row) return;
    row.innerHTML = '';
    THEMES.forEach(function (theme) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pf-swatch';
      btn.setAttribute('aria-pressed', String(state.theme === theme.id));
      btn.innerHTML =
        '<span class="pf-swatch-box" style="background:' + theme.swatch + '"></span>' +
        '<span class="pf-swatch-name"></span>';
      btn.querySelector('.pf-swatch-name').textContent = theme.name;
      btn.addEventListener('click', function () {
        state.theme = theme.id;
        renderThemes();
      });
      row.appendChild(btn);
    });
  }

  function renderAccents() {
    var row = $('pf-accents');
    if (!row) return;
    row.innerHTML = '';
    ACCENTS.forEach(function (hex) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pf-swatch';
      btn.setAttribute('aria-pressed', String(state.accent === hex));
      btn.setAttribute('aria-label', 'Highlight colour ' + hex);
      btn.innerHTML = '<span class="pf-swatch-box" style="background:' + hex + '"></span>';
      btn.addEventListener('click', function () {
        state.accent = hex;
        renderAccents();
      });
      row.appendChild(btn);
    });
  }

  // --- uploads -------------------------------------------------------------
  //
  // The browser never gets a key that can write to storage. It asks the edge
  // function for a one-file signed URL, uses it, and throws it away.

  var sbClient = null;
  function storageClient() {
    if (sbClient) return sbClient;
    if (!window.supabase || !window.supabase.createClient) return null;
    sbClient = window.supabase.createClient(SUPABASE_URL, ACADEMY_ANON_KEY);
    return sbClient;
  }

  function uploadFile(file, onProgress) {
    if (!file) return Promise.reject(new Error('No file picked.'));
    if (file.size > MAX_FILE_BYTES) {
      return Promise.reject(new Error('That file is over 25MB. Try a smaller one.'));
    }
    var client = storageClient();
    if (!client) {
      return Promise.reject(new Error('Upload tool did not load. Refresh the page and try again.'));
    }
    if (onProgress) onProgress('Uploading' + '…');
    return api({
      type: 'portfolioUpload',
      studentId: student.studentId,
      contentType: file.type
    }).then(function (res) {
      return client.storage
        .from(res.bucket)
        .uploadToSignedUrl(res.path, res.token, file, { contentType: file.type })
        .then(function (out) {
          if (out.error) throw new Error(out.error.message || 'Upload failed.');
          if (onProgress) onProgress('');
          return res.path;
        });
    });
  }

  function mediaUrl(path) {
    if (!path) return '';
    return storageBase + path;
  }

  // --- work items ----------------------------------------------------------

  function blankWork() {
    return { title: '', label: '', link: '', image: '', video: '' };
  }

  function renderWorks() {
    var wrap = $('pf-works');
    if (!wrap) return;
    wrap.innerHTML = '';

    state.works.forEach(function (work, index) {
      var card = document.createElement('div');
      card.className = 'pf-work';

      var head = document.createElement('div');
      head.className = 'pf-work-head';
      var num = document.createElement('span');
      num.className = 'pf-work-num';
      num.textContent = 'Piece ' + (index + 1);
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pf-link-btn';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () {
        state.works.splice(index, 1);
        renderWorks();
      });
      head.appendChild(num);
      head.appendChild(remove);
      card.appendChild(head);

      var grid = document.createElement('div');
      grid.className = 'pf-grid';
      grid.appendChild(field('Title', 'text', work.title, 70, 'Skincare demo, 30 seconds', function (v) { work.title = v; }));
      grid.appendChild(field('Link to it (optional)', 'url', work.link, 500, 'https://', function (v) { work.link = v; }));
      card.appendChild(grid);

      card.appendChild(field('One line on what it is', 'text', work.label, 120, 'Problem-solution demo, paid social format, filmed at home', function (v) { work.label = v; }, true));

      var media = document.createElement('div');
      media.className = 'pf-work-media';

      var thumb = document.createElement('div');
      thumb.className = 'pf-work-thumb';
      if (work.image) thumb.style.backgroundImage = 'url("' + mediaUrl(work.image) + '")';
      media.appendChild(thumb);

      var controls = document.createElement('div');

      controls.appendChild(
        filePicker('Upload a picture', 'image/jpeg,image/png,image/webp', function (file, status) {
          return uploadFile(file, status).then(function (path) {
            work.image = path;
            renderWorks();
          });
        })
      );
      controls.appendChild(
        filePicker('Upload a video', 'video/mp4,video/quicktime', function (file, status) {
          return uploadFile(file, status).then(function (path) {
            work.video = path;
            renderWorks();
          });
        })
      );

      if (work.video) {
        var vNote = document.createElement('p');
        vNote.className = 'pf-upload-status';
        vNote.textContent = 'Video attached.';
        controls.appendChild(vNote);
      }

      media.appendChild(controls);
      card.appendChild(media);
      wrap.appendChild(card);
    });

    var addBtn = $('pf-add-work');
    if (addBtn) addBtn.disabled = state.works.length >= MAX_WORKS;
  }

  function field(labelText, type, value, maxlength, placeholder, onInput, block) {
    var label = document.createElement('label');
    if (block) label.className = 'pf-block';
    label.appendChild(document.createTextNode(labelText));
    var input = document.createElement('input');
    input.type = type === 'url' ? 'url' : 'text';
    input.value = value || '';
    input.maxLength = maxlength;
    input.placeholder = placeholder || '';
    input.addEventListener('input', function () { onInput(input.value); });
    label.appendChild(input);
    return label;
  }

  function filePicker(text, accept, handler) {
    var label = document.createElement('label');
    label.className = 'pf-file';
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    var span = document.createElement('span');
    span.textContent = text;
    var status = document.createElement('p');
    status.className = 'pf-upload-status';

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      setError('');
      handler(file, function (msg) { status.textContent = msg; }).catch(function (err) {
        status.textContent = '';
        setError(err.message || 'That upload did not work.');
      });
      input.value = '';
    });

    label.appendChild(input);
    label.appendChild(span);
    var holder = document.createElement('div');
    holder.appendChild(label);
    holder.appendChild(status);
    return holder;
  }

  // --- load and save -------------------------------------------------------

  function fillForm(portfolio) {
    var p = portfolio || {};
    $('pf-name').value = p.name || (student && student.name) || '';
    $('pf-headline').value = p.headline || '';
    $('pf-location').value = p.location || '';
    $('pf-rates').value = p.rates || '';
    $('pf-bio').value = p.bio || '';
    $('pf-email').value = p.email || '';
    $('pf-instagram').value = p.instagram || '';
    $('pf-tiktok').value = p.tiktok || '';
    $('pf-website').value = p.website || '';
    state.theme = p.theme || 'ink';
    state.accent = p.accent || '#d9f125';
    state.avatar = p.avatar || '';
    state.works = Array.isArray(p.works) && p.works.length
      ? p.works.slice(0, MAX_WORKS)
      : [blankWork()];
    renderThemes();
    renderAccents();
    renderWorks();
    renderAvatar();
  }

  function renderAvatar() {
    var preview = $('pf-avatar-preview');
    var clear = $('pf-avatar-clear');
    if (preview) {
      preview.style.backgroundImage = state.avatar ? 'url("' + mediaUrl(state.avatar) + '")' : '';
    }
    if (clear) clear.hidden = !state.avatar;
  }

  function collect() {
    return {
      name: $('pf-name').value,
      headline: $('pf-headline').value,
      location: $('pf-location').value,
      rates: $('pf-rates').value,
      bio: $('pf-bio').value,
      email: $('pf-email').value,
      instagram: $('pf-instagram').value,
      tiktok: $('pf-tiktok').value,
      website: $('pf-website').value,
      theme: state.theme,
      accent: state.accent,
      avatar: state.avatar,
      works: state.works
    };
  }

  function applySlug(slug, published) {
    state.slug = slug || '';
    state.published = published === true;
    var input = $('pf-slug');
    if (input && state.slug) {
      input.value = state.slug;
      input.readOnly = true;
      state.slugLocked = true;
      var note = $('pf-slug-note');
      if (note) note.textContent = 'This is your address and it does not change, so a link you have already sent keeps working.';
    }
    var live = $('pf-live');
    var link = $('pf-live-link');
    if (live && link) {
      if (state.slug && state.published) {
        link.href = PUBLIC_BASE + encodeURIComponent(state.slug);
        link.textContent = 'clickclick.video/creators/p/?c=' + state.slug;
        live.hidden = false;
      } else {
        live.hidden = true;
      }
    }
    var off = $('pf-unpublish');
    if (off) off.hidden = !state.published;
  }

  function save(published) {
    setError('');
    var buttons = [$('pf-save-draft'), $('pf-publish'), $('pf-unpublish')];
    buttons.forEach(function (b) { if (b) b.disabled = true; });

    return api({
      type: 'portfolioSave',
      studentId: student.studentId,
      slug: state.slugLocked ? state.slug : $('pf-slug').value,
      portfolio: collect(),
      published: published
    })
      .then(function (res) {
        applySlug(res.slug, res.published);
        flashSaved(published ? 'Published' : 'Draft saved');
      })
      .catch(function (err) {
        setError(err.message || 'Could not save that. Try again.');
      })
      .then(function () {
        buttons.forEach(function (b) { if (b) b.disabled = false; });
      });
  }

  function wire() {
    $('pf-add-work').addEventListener('click', function () {
      if (state.works.length >= MAX_WORKS) return;
      state.works.push(blankWork());
      renderWorks();
    });

    $('pf-avatar').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      setError('');
      uploadFile(file)
        .then(function (path) {
          state.avatar = path;
          renderAvatar();
        })
        .catch(function (err) { setError(err.message || 'That upload did not work.'); });
      e.target.value = '';
    });

    $('pf-avatar-clear').addEventListener('click', function () {
      state.avatar = '';
      renderAvatar();
    });

    $('pf-save-draft').addEventListener('click', function () { save(false); });
    $('pf-unpublish').addEventListener('click', function () { save(false); });
    $('pf-editor').addEventListener('submit', function (e) {
      e.preventDefault();
      save(true);
    });
  }

  function start() {
    if (!student || !student.studentId) {
      show('pf-nosession');
      return;
    }
    api({ type: 'portfolioGet', studentId: student.studentId })
      .then(function (res) {
        if (res.storageBase) storageBase = res.storageBase;
        show('pf-editor');
        fillForm(res.portfolio);
        applySlug(res.slug, res.published);
        if (!res.slug && res.suggestedSlug) $('pf-slug').value = res.suggestedSlug;
        wire();
      })
      .catch(function (err) {
        if (err.data && err.data.entitled === false) {
          var why = $('pf-locked-why');
          if (why && err.message) why.textContent = err.message;
          show('pf-locked');
          return;
        }
        show('pf-nosession');
        var el = $('pf-nosession');
        if (el) {
          var p = el.querySelector('p');
          if (p) p.textContent = err.message || 'Could not load your page. Try again in a minute.';
        }
      });
  }

  start();
})();
