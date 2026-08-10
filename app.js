/**
 * ClickClick Academy — pack-based access.
 * Access codes unlock a pack of course IDs. Hidden courses stay hidden (no lock teasers).
 * Not real auth — replace before wide public launch.
 */
(function () {
  var STORAGE_KEY = 'clickclick_academy_session_v2';
  var LEGACY_OK_KEY = 'clickclick_academy_ok_v1';

  var gate = document.getElementById('gate');
  var app = document.getElementById('app');
  var form = document.getElementById('gate-form');
  var input = document.getElementById('access-code');
  var err = document.getElementById('gate-error');
  var logout = document.getElementById('logout');
  var search = document.getElementById('course-search');
  var grid = document.getElementById('courses-grid');
  var preview = document.getElementById('courses-preview');
  var countEl = document.getElementById('course-count');
  var packLabelEl = document.getElementById('pack-label');
  var greetingEl = document.querySelector('.greeting');
  var welcomeCopy = document.querySelector('#view-dashboard .welcome-card p');
  var coursesSub = document.querySelector('#view-courses .sub');
  var dashCountStrong = document.querySelector('#view-dashboard .chip strong');
  var viewDash = document.getElementById('view-dashboard');
  var viewCourses = document.getElementById('view-courses');

  var allCourses = [];
  var packsByCode = {};
  var session = null;
  var allowedCourses = [];

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadSession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.courseIds)) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function saveSession(data) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      sessionStorage.removeItem(LEGACY_OK_KEY);
    } catch (e) {}
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_OK_KEY);
    } catch (e) {}
  }

  function findPack(code) {
    if (!code) return null;
    var trimmed = String(code).trim();
    if (!trimmed) return null;
    if (packsByCode[trimmed]) {
      return { code: trimmed, pack: packsByCode[trimmed] };
    }
    var lower = trimmed.toLowerCase();
    var keys = Object.keys(packsByCode);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) {
        return { code: keys[i], pack: packsByCode[keys[i]] };
      }
    }
    return null;
  }

  function coursesForPack(pack) {
    var ids = pack.courseIds || [];
    var byId = {};
    allCourses.forEach(function (c) {
      byId[c.id] = c;
    });
    var list = [];
    ids.forEach(function (id) {
      if (byId[id]) list.push(byId[id]);
    });
    return list;
  }

  function audienceGreeting(audience) {
    if (audience === 'corporate') return 'Hello, team';
    if (audience === 'agency') return 'Hello, agency';
    if (audience === 'creator') return 'Hello, creator';
    if (audience === 'staff') return 'Hello, staff';
    if (audience === 'live-host') return 'Hello, host';
    if (audience === 'internal') return 'Hello, ClickClick';
    return 'Hello';
  }

  function applySessionUi() {
    var label = (session && session.label) || 'Your pack';
    var audience = (session && session.audience) || '';
    var n = allowedCourses.length;

    if (greetingEl) greetingEl.textContent = audienceGreeting(audience);
    if (packLabelEl) packLabelEl.textContent = label;
    if (welcomeCopy) {
      welcomeCopy.textContent =
        'These are the courses in your pack. Other catalogs stay hidden.';
    }
    if (coursesSub) {
      coursesSub.textContent = label + ' · short lessons';
    }
    if (dashCountStrong) dashCountStrong.textContent = String(n);
    if (countEl) countEl.textContent = n + (n === 1 ? ' course' : ' courses');
  }

  function cardHtml(course) {
    var statusClass = course.statusClass ? ' status ' + course.statusClass : ' status';
    var openAttr = course.href ? ' data-href="' + esc(course.href) + '"' : '';
    var lessons = Number(course.lessons) || 0;
    return (
      '<article class="course-card" data-id="' +
      esc(course.id) +
      '" data-title="' +
      esc(String(course.title || '').toLowerCase()) +
      '" data-tag="' +
      esc(String(course.tag || '').toLowerCase()) +
      '"' +
      openAttr +
      '>' +
      '<div class="course-visual" style="background:' +
      esc(course.tone || '#ebe4f5') +
      '">' +
      '<span class="course-lessons">' +
      lessons +
      (lessons === 1 ? ' lesson' : ' lessons') +
      '</span>' +
      '<span class="course-icon" aria-hidden="true">' +
      esc(course.icon || '▶') +
      '</span>' +
      '</div>' +
      '<div class="course-body">' +
      '<span class="course-tag">' +
      esc(course.tag || '') +
      '</span>' +
      '<h3>' +
      esc(course.title || '') +
      '</h3>' +
      (course.description
        ? '<p class="course-desc">' + esc(course.description) + '</p>'
        : '') +
      '<div class="course-meta">' +
      '<span>Level: ' +
      esc(course.level || '') +
      '</span>' +
      '<span class="' +
      statusClass.trim() +
      '">' +
      esc(course.status || 'Not started') +
      '</span>' +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  function renderCourses() {
    applySessionUi();
    if (grid) {
      grid.innerHTML = allowedCourses.map(cardHtml).join('');
    }
    if (preview) {
      preview.innerHTML = allowedCourses.slice(0, 3).map(cardHtml).join('');
    }
  }

  function showApp(ok) {
    if (ok) {
      gate.hidden = true;
      app.hidden = false;
      renderCourses();
    } else {
      gate.hidden = false;
      app.hidden = true;
    }
  }

  function setView(name) {
    var isDash = name === 'dashboard';
    if (viewDash) viewDash.hidden = !isDash;
    if (viewCourses) viewCourses.hidden = isDash;
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === name);
    });
  }

  function filterCourses(q) {
    var query = (q || '').trim().toLowerCase();
    document.querySelectorAll('#courses-grid .course-card').forEach(function (card) {
      if (!query) {
        card.classList.remove('is-hidden');
        return;
      }
      var hay =
        (card.getAttribute('data-title') || '') +
        ' ' +
        (card.getAttribute('data-tag') || '');
      card.classList.toggle('is-hidden', hay.indexOf(query) === -1);
    });
  }

  function enterWithPack(match) {
    var pack = match.pack;
    session = {
      code: match.code,
      label: pack.label || match.code,
      audience: pack.audience || '',
      courseIds: pack.courseIds || [],
    };
    allowedCourses = coursesForPack(pack);
    saveSession(session);
    if (err) err.hidden = true;
    showApp(true);
  }

  function restoreOrGate() {
    var saved = loadSession();
    if (!saved) {
      try {
        if (sessionStorage.getItem(LEGACY_OK_KEY) === '1' && packsByCode.internal) {
          enterWithPack({ code: 'internal', pack: packsByCode.internal });
          return;
        }
      } catch (e) {}
      showApp(false);
      return;
    }
    var match = findPack(saved.code);
    if (match) {
      enterWithPack(match);
      return;
    }
    session = saved;
    var byId = {};
    allCourses.forEach(function (c) {
      byId[c.id] = c;
    });
    allowedCourses = (saved.courseIds || [])
      .map(function (id) {
        return byId[id];
      })
      .filter(Boolean);
    showApp(true);
  }

  function boot() {
    Promise.all([
      fetch('courses.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('courses');
        return r.json();
      }),
      fetch('packs.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('packs');
        return r.json();
      }),
    ])
      .then(function (pair) {
        allCourses = Array.isArray(pair[0]) ? pair[0] : [];
        packsByCode = pair[1] && typeof pair[1] === 'object' ? pair[1] : {};
        restoreOrGate();
      })
      .catch(function () {
        if (err) {
          err.textContent = 'Could not load courses. Refresh and try again.';
          err.hidden = false;
        }
        showApp(false);
      });
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = (input && input.value) || '';
      var match = findPack(value);
      if (match) {
        enterWithPack(match);
        if (input) input.value = '';
      } else {
        if (err) {
          err.textContent = 'That code did not work. Try again or ask ClickClick.';
          err.hidden = false;
        }
        if (input) {
          input.value = '';
          input.focus();
        }
      }
    });
  }

  if (logout) {
    logout.addEventListener('click', function () {
      clearSession();
      session = null;
      allowedCourses = [];
      if (input) input.value = '';
      showApp(false);
    });
  }

  document.querySelectorAll('[data-view]').forEach(function (el) {
    el.addEventListener('click', function () {
      setView(el.getAttribute('data-view'));
    });
  });

  if (search) {
    search.addEventListener('input', function () {
      setView('courses');
      filterCourses(search.value);
    });
  }

  document.addEventListener('click', function (e) {
    var card = e.target.closest('.course-card[data-href]');
    if (card && card.getAttribute('data-href')) {
      window.location.href = card.getAttribute('data-href');
    }
  });

  boot();
})();
