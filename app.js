/**
 * ClickClick Academy — pack-based access.
 * Access codes unlock a pack of course IDs. Hidden courses stay hidden (no lock teasers).
 * Not real auth — replace before wide public launch.
 */
(function () {
  var STORAGE_KEY = 'clickclick_academy_session_v2';
  var LEGACY_OK_KEY = 'clickclick_academy_ok_v1';
  var STUDENT_KEY = 'clickclick_academy_student_v1';

  var ACADEMY_API =
    'https://gapybapywpdogexibtgj.supabase.co/functions/v1/academy-progress';
  var ACADEMY_ANON_KEY = 'sb_publishable_H6AqSkDWFjR42ff7YE1MIw_-qU2z0OT';

  function academyApi(payload) {
    return fetch(ACADEMY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ACADEMY_ANON_KEY,
        Authorization: 'Bearer ' + ACADEMY_ANON_KEY,
      },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.error ? data.error : 'Request failed');
        return data;
      });
    });
  }

  function loadStudent() {
    try {
      var raw = localStorage.getItem(STUDENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveStudent(s) {
    try {
      localStorage.setItem(STUDENT_KEY, JSON.stringify(s));
    } catch (e) {}
  }

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
  var viewDetail = document.getElementById('view-course-detail');
  var detailBody = document.getElementById('course-detail-body');
  var detailBack = document.getElementById('course-detail-back');

  var allCourses = [];
  var packsByCode = {};
  var session = null;
  var allowedCourses = [];
  var lastListView = 'courses';

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
    var hasDetail = !course.href && Array.isArray(course.modules);
    var isInert = !course.href && !hasDetail;
    var openAttr = course.href ? ' data-href="' + esc(course.href) + '"' : '';
    var detailAttr = hasDetail ? ' data-detail="1"' : '';
    var lessons = Number(course.lessons) || 0;

    // Placeholder catalog entries (no href, no real lesson content) get an
    // honest "Coming soon" badge instead of "Not started" — that copy
    // implies there's something to start, which there isn't yet.
    var statusText = isInert ? 'Coming soon' : (course.status || 'Not started');
    var statusClass = isInert
      ? 'status is-coming-soon'
      : (course.statusClass ? 'status ' + course.statusClass : 'status');

    return (
      '<article class="course-card' +
      (detailAttr ? ' is-openable' : '') +
      (isInert ? ' is-inert' : '') +
      '" data-id="' +
      esc(course.id) +
      '" data-title="' +
      esc(String(course.title || '').toLowerCase()) +
      '" data-tag="' +
      esc(String(course.tag || '').toLowerCase()) +
      '"' +
      openAttr +
      detailAttr +
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
      statusClass +
      '">' +
      esc(statusText) +
      '</span>' +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  // Flat, in-order list of every lesson's num across all modules — used to
  // find "the lesson before this one" for unlock checks.
  function flatLessonNums(course) {
    var nums = [];
    (course.modules || []).forEach(function (m) {
      (m.lessons || []).forEach(function (l) {
        nums.push(l.num);
      });
    });
    return nums;
  }

  function lessonHtml(lesson, state) {
    // state: 'locked' | 'open' | 'submitted'
    var statusBadge =
      state === 'submitted'
        ? '<span class="lesson-status lesson-status--done">&#10003; Submitted</span>'
        : state === 'locked'
          ? '<span class="lesson-status lesson-status--locked">Locked</span>'
          : '';
    var submitted = state === 'submitted' ? lesson._submitted : null;

    var actionHtml;
    if (state === 'locked') {
      actionHtml =
        '<p class="lesson-locked-note">Submit the lesson before this one to unlock it.</p>';
    } else if (state === 'submitted') {
      actionHtml =
        '<div class="lesson-submitted-box">' +
        (submitted && submitted.note
          ? '<p class="lesson-submitted-note">' + esc(submitted.note) + '</p>'
          : '') +
        (submitted && submitted.filePath
          ? '<p class="lesson-submitted-file">File attached &#10003;</p>'
          : '') +
        '<button type="button" class="link-btn lesson-resubmit-btn" data-lesson="' +
        esc(lesson.num) +
        '">Resubmit</button>' +
        '</div>';
    } else {
      actionHtml =
        '<div class="lesson-submit-form" data-lesson="' + esc(lesson.num) + '">' +
        '<label class="sr-only" for="note-' + esc(lesson.num) + '">Your notes</label>' +
        '<textarea id="note-' +
        esc(lesson.num) +
        '" class="lesson-note-input" placeholder="Paste your work, or describe what you did…"></textarea>' +
        '<div class="lesson-submit-row">' +
        '<input type="file" class="lesson-file-input" aria-label="Attach a file (optional)" />' +
        '<button type="button" class="btn primary lesson-submit-btn" data-lesson="' +
        esc(lesson.num) +
        '">Submit &amp; unlock next</button>' +
        '</div>' +
        '<p class="lesson-submit-err" hidden></p>' +
        '</div>';
    }

    return (
      '<article class="lesson-card lesson-card--' + state + '">' +
      '<div class="lesson-card-head">' +
      '<span class="lesson-num">' + esc(lesson.num || '') + '</span>' +
      '<h4>' + esc(lesson.title || '') + '</h4>' +
      statusBadge +
      '</div>' +
      (lesson.overview ? '<p class="lesson-overview">' + esc(lesson.overview) + '</p>' : '') +
      '<div class="lesson-field lesson-field--interactive">' +
      '<span class="lesson-field-label">Interactive</span>' +
      '<span class="lesson-field-body">' + esc(lesson.interactive || '') + '</span>' +
      '</div>' +
      '<div class="lesson-field lesson-field--deliverable">' +
      '<span class="lesson-field-label">Deliverable</span>' +
      '<span class="lesson-field-body">' + esc(lesson.deliverable || '') + '</span>' +
      '</div>' +
      actionHtml +
      '</article>'
    );
  }

  function moduleHtml(mod, index, submittedByNum) {
    var lessons = Array.isArray(mod.lessons) ? mod.lessons : [];
    return (
      '<section class="module-block">' +
      '<div class="module-block-head">' +
      '<span class="module-block-num">Module ' + String(index + 1).padStart(2, '0') + '</span>' +
      '<h3>' + esc(mod.title || '') + '</h3>' +
      '</div>' +
      (mod.frame ? '<p class="module-block-frame">' + esc(mod.frame) + '</p>' : '') +
      lessons
        .map(function (lesson) {
          return lessonHtml(lesson, lessonState(lesson, submittedByNum));
        })
        .join('') +
      '</section>'
    );
  }

  // A lesson is: submitted (in the map), locked (some earlier lesson isn't
  // submitted yet), or open (the first not-yet-submitted lesson, or lesson
  // 1 with nothing submitted at all).
  var currentAllNums = [];
  function lessonState(lesson, submittedByNum) {
    if (submittedByNum[lesson.num]) {
      lesson._submitted = submittedByNum[lesson.num];
      return 'submitted';
    }
    var idx = currentAllNums.indexOf(lesson.num);
    if (idx <= 0) return 'open';
    var prevNum = currentAllNums[idx - 1];
    return submittedByNum[prevNum] ? 'open' : 'locked';
  }

  function courseDetailHtml(course, submittedByNum) {
    var modules = Array.isArray(course.modules) ? course.modules : [];
    var lessonCount = modules.reduce(function (n, m) {
      return n + (Array.isArray(m.lessons) ? m.lessons.length : 0);
    }, 0);
    var doneCount = Object.keys(submittedByNum).length;
    currentAllNums = flatLessonNums(course);
    return (
      '<div class="detail-head">' +
      '<span class="course-tag">' + esc(course.tag || '') + '</span>' +
      '<h1>' + esc(course.title || '') + '</h1>' +
      (course.description ? '<p class="detail-lead">' + esc(course.description) + '</p>' : '') +
      '<div class="detail-meta">' +
      '<span>' + modules.length + (modules.length === 1 ? ' module' : ' modules') + '</span>' +
      '<span>' + doneCount + ' / ' + lessonCount + ' lessons done</span>' +
      '<span>Level: ' + esc(course.level || '') + '</span>' +
      '</div>' +
      '</div>' +
      modules.map(function (m, i) { return moduleHtml(m, i, submittedByNum); }).join('')
    );
  }

  function identifyGateHtml(course) {
    return (
      '<div class="detail-head detail-identify">' +
      '<span class="course-tag">' + esc(course.tag || '') + '</span>' +
      '<h1>' + esc(course.title || '') + '</h1>' +
      (course.description ? '<p class="detail-lead">' + esc(course.description) + '</p>' : '') +
      '<p class="detail-lead">Tell us who you are so your progress is saved — each lesson unlocks the next once you submit its deliverable.</p>' +
      '<form id="identify-form" class="identify-form">' +
      '<input type="text" id="identify-name" placeholder="Your name" required />' +
      '<input type="email" id="identify-email" placeholder="Your email" required />' +
      '<button type="submit" class="btn primary">Start the course</button>' +
      '<p class="lesson-submit-err" id="identify-err" hidden></p>' +
      '</form>' +
      '</div>'
    );
  }

  var currentDetailCourse = null;

  function renderProgress(course) {
    var student = loadStudent();
    if (!student) {
      detailBody.innerHTML = identifyGateHtml(course);
      var idForm = document.getElementById('identify-form');
      if (idForm) {
        idForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var name = document.getElementById('identify-name').value.trim();
          var email = document.getElementById('identify-email').value.trim();
          var errEl = document.getElementById('identify-err');
          academyApi({
            type: 'identify',
            name: name,
            email: email,
            accessCode: (session && session.code) || '',
          })
            .then(function (data) {
              saveStudent({ studentId: data.studentId, name: data.name });
              renderProgress(course);
            })
            .catch(function (err) {
              if (errEl) {
                errEl.textContent = err.message || 'Could not save that — try again.';
                errEl.hidden = false;
              }
            });
        });
      }
      return;
    }

    detailBody.innerHTML = '<p class="detail-loading">Loading your progress…</p>';
    academyApi({ type: 'list', studentId: student.studentId, courseId: course.id })
      .then(function (data) {
        var byNum = {};
        (data.progress || []).forEach(function (p) {
          byNum[p.lessonNum] = p;
        });
        detailBody.innerHTML = courseDetailHtml(course, byNum);
      })
      .catch(function () {
        detailBody.innerHTML = courseDetailHtml(course, {});
      });
  }

  function openCourseDetail(id) {
    var course = allCourses.filter(function (c) { return c.id === id; })[0];
    if (!course || !Array.isArray(course.modules) || !detailBody) return;
    currentDetailCourse = course;
    setView('detail');
    if (viewDetail) viewDetail.scrollTop = 0;
    renderProgress(course);
  }

  function submitLesson(lessonNum, cardEl) {
    var student = loadStudent();
    if (!student || !currentDetailCourse) return;
    var note = cardEl.querySelector('.lesson-note-input')
      ? cardEl.querySelector('.lesson-note-input').value.trim()
      : '';
    var fileInput = cardEl.querySelector('.lesson-file-input');
    var file = fileInput && fileInput.files && fileInput.files[0];
    var errEl = cardEl.querySelector('.lesson-submit-err');
    var btn = cardEl.querySelector('.lesson-submit-btn');
    if (errEl) errEl.hidden = true;
    if (!note && !file) {
      if (errEl) {
        errEl.textContent = 'Add a note or attach a file first.';
        errEl.hidden = false;
      }
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting…';
    }

    var uploadStep = file
      ? academyApi({
          type: 'uploadUrl',
          studentId: student.studentId,
          courseId: currentDetailCourse.id,
          lessonNum: lessonNum,
          fileName: file.name,
        }).then(function (up) {
          return fetch(up.signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          }).then(function (res) {
            if (!res.ok) throw new Error('File upload failed — try again.');
            return up.path;
          });
        })
      : Promise.resolve(null);

    uploadStep
      .then(function (filePath) {
        return academyApi({
          type: 'submit',
          studentId: student.studentId,
          courseId: currentDetailCourse.id,
          lessonNum: lessonNum,
          note: note,
          filePath: filePath,
        });
      })
      .then(function () {
        renderProgress(currentDetailCourse);
      })
      .catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Submit & unlock next';
        }
        if (errEl) {
          errEl.textContent = err.message || 'Could not submit — try again.';
          errEl.hidden = false;
        }
      });
  }

  // Groups by tag, preserving first-seen order, so a mixed pack (mainly the
  // internal/admin one, which sees every audience at once) reads as
  // sections instead of one flat 21-card wall. A single-audience pack
  // (what every real customer actually has) only ever has one group, so
  // this renders as a plain grid for them — no redundant lone header.
  function groupedCoursesHtml(courses) {
    var order = [];
    var byTag = {};
    courses.forEach(function (c) {
      var tag = c.tag || 'Other';
      if (!byTag[tag]) {
        byTag[tag] = [];
        order.push(tag);
      }
      byTag[tag].push(c);
    });
    if (order.length <= 1) {
      return '<div class="courses-grid">' + courses.map(cardHtml).join('') + '</div>';
    }
    return order
      .map(function (tag) {
        return (
          '<div class="course-group">' +
          '<h3 class="course-group-head">' + esc(tag) + '</h3>' +
          '<div class="courses-grid">' + byTag[tag].map(cardHtml).join('') + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderCourses() {
    applySessionUi();
    if (grid) {
      grid.innerHTML = groupedCoursesHtml(allowedCourses);
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
    if (name === 'detail') {
      if (viewDash) viewDash.hidden = true;
      if (viewCourses) viewCourses.hidden = true;
      if (viewDetail) viewDetail.hidden = false;
      return;
    }
    lastListView = name;
    var isDash = name === 'dashboard';
    if (viewDash) viewDash.hidden = !isDash;
    if (viewCourses) viewCourses.hidden = isDash;
    if (viewDetail) viewDetail.hidden = true;
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
    var hrefCard = e.target.closest('.course-card[data-href]');
    if (hrefCard && hrefCard.getAttribute('data-href')) {
      window.location.href = hrefCard.getAttribute('data-href');
      return;
    }
    var detailCard = e.target.closest('.course-card[data-detail]');
    if (detailCard) {
      openCourseDetail(detailCard.getAttribute('data-id'));
      return;
    }
    var submitBtn = e.target.closest('.lesson-submit-btn');
    if (submitBtn) {
      var lessonNum = submitBtn.getAttribute('data-lesson');
      var card = submitBtn.closest('.lesson-card');
      if (lessonNum && card) submitLesson(lessonNum, card);
      return;
    }
    var resubmitBtn = e.target.closest('.lesson-resubmit-btn');
    if (resubmitBtn && currentDetailCourse) {
      // Re-render this lesson as its open (form) state so they can redo it —
      // simplest way is just re-fetching progress fresh and letting the
      // lesson map decide, minus this one lesson's existing submission.
      var num = resubmitBtn.getAttribute('data-lesson');
      var student = loadStudent();
      if (student && num) {
        detailBody.innerHTML = '<p class="detail-loading">Loading…</p>';
        academyApi({ type: 'list', studentId: student.studentId, courseId: currentDetailCourse.id })
          .then(function (data) {
            var byNum = {};
            (data.progress || []).forEach(function (p) {
              if (p.lessonNum !== num) byNum[p.lessonNum] = p;
            });
            detailBody.innerHTML = courseDetailHtml(currentDetailCourse, byNum);
          });
      }
    }
  });

  if (detailBack) {
    detailBack.addEventListener('click', function () {
      setView(lastListView);
    });
  }

  boot();
})();
