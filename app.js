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

  // ---- Lesson activities: real, checkable widgets, not description text ----
  // Completion is a badge only — it never gates the deliverable/unlock flow
  // (that stays driven by academy_progress). Kept in localStorage since it's
  // just "have you had a go at this," not something worth a server round trip.
  var ACTIVITY_DONE_KEY = 'clickclick_academy_activity_v1';
  function loadActivityDone() {
    try {
      var raw = localStorage.getItem(ACTIVITY_DONE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function markActivityDone(lessonNum) {
    var map = loadActivityDone();
    if (map[lessonNum]) return;
    map[lessonNum] = true;
    try {
      localStorage.setItem(ACTIVITY_DONE_KEY, JSON.stringify(map));
    } catch (e) {}
    var badge = document.querySelector(
      '.activity[data-lesson="' + lessonNum + '"] .activity-done-badge'
    );
    if (badge) badge.hidden = false;
  }

  function shuffled(arr) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function activityHtml(lessonNum, activity) {
    var done = loadActivityDone()[lessonNum];
    var body;
    switch (activity.kind) {
      case 'quiz':
        body = activityQuizHtml(lessonNum, activity);
        break;
      case 'sequence':
        body = activitySequenceHtml(lessonNum, activity);
        break;
      case 'match':
        body = activityMatchHtml(lessonNum, activity);
        break;
      case 'rubric':
        body = activityRubricHtml(lessonNum, activity);
        break;
      case 'allocator':
        body = activityAllocatorHtml(lessonNum, activity);
        break;
      case 'checklist':
        body = activityChecklistHtml(lessonNum, activity);
        break;
      case 'builder':
        body = activityBuilderHtml(lessonNum, activity);
        break;
      default:
        return '';
    }
    return (
      '<div class="activity activity--' +
      esc(activity.kind) +
      '" data-activity-kind="' +
      esc(activity.kind) +
      '" data-lesson="' +
      esc(lessonNum) +
      '">' +
      '<div class="activity-head">' +
      '<span class="activity-badge">Try it</span>' +
      '<span class="activity-done-badge"' +
      (done ? '' : ' hidden') +
      '>&#10003; done</span>' +
      '</div>' +
      (activity.prompt ? '<p class="activity-prompt">' + esc(activity.prompt) + '</p>' : '') +
      body +
      '</div>'
    );
  }

  function activityQuizHtml(lessonNum, activity) {
    return (activity.questions || [])
      .map(function (q, qi) {
        return (
          '<div class="activity-quiz-q" data-lesson="' +
          esc(lessonNum) +
          '" data-correct="' +
          q.correct +
          '">' +
          '<p class="activity-quiz-question">' + esc(q.q) + '</p>' +
          '<div class="activity-quiz-options">' +
          q.options
            .map(function (opt, oi) {
              return (
                '<button type="button" class="activity-quiz-opt" data-opt="' +
                oi +
                '">' +
                esc(opt) +
                '</button>'
              );
            })
            .join('') +
          '</div>' +
          '<p class="activity-quiz-explain" hidden>' + esc(q.explain || '') + '</p>' +
          '</div>'
        );
      })
      .join('');
  }

  function activitySequenceHtml(lessonNum, activity) {
    var items = activity.items || [];
    var order = shuffled(items.map(function (text, i) { return i; }));
    // Re-shuffle once if it happened to land in the exact correct order —
    // otherwise the exercise is trivially "already right."
    var target = activity.topN || items.length;
    var isExact = order.every(function (v, i) { return v === i; });
    if (isExact && items.length > 1) {
      var a = order[0];
      order[0] = order[1];
      order[1] = a;
    }
    return (
      '<ol class="activity-seq-list" data-target="' + target + '">' +
      order
        .map(function (origIdx, pos) {
          return (
            '<li class="activity-seq-item" data-correct-idx="' +
            origIdx +
            '">' +
            '<span class="activity-seq-text">' + esc(items[origIdx]) + '</span>' +
            '<span class="activity-seq-controls">' +
            '<button type="button" class="activity-seq-move" data-dir="up" aria-label="Move up">&#8593;</button>' +
            '<button type="button" class="activity-seq-move" data-dir="down" aria-label="Move down">&#8595;</button>' +
            '</span>' +
            '<span class="activity-seq-mark"></span>' +
            '</li>'
          );
        })
        .join('') +
      '</ol>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="sequence">Check order</button>' +
      '<p class="activity-result" hidden></p>'
    );
  }

  function activityMatchHtml(lessonNum, activity) {
    var categories = activity.categories || [];
    return (
      '<div class="activity-match">' +
      (activity.items || [])
        .map(function (item) {
          return (
            '<div class="activity-match-row" data-correct="' + item.correct + '">' +
            '<span class="activity-match-label">' + esc(item.label) + '</span>' +
            '<select class="activity-match-select">' +
            '<option value="">Choose…</option>' +
            categories
              .map(function (cat, ci) {
                return '<option value="' + ci + '">' + esc(cat) + '</option>';
              })
              .join('') +
            '</select>' +
            '<span class="activity-match-mark"></span>' +
            '</div>'
          );
        })
        .join('') +
      '</div>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="match">Check answers</button>' +
      '<p class="activity-result" hidden></p>'
    );
  }

  function activityRubricHtml(lessonNum, activity) {
    var criteria = activity.criteria || [];
    return (
      '<div class="activity-rubric">' +
      (activity.subjects || [])
        .map(function (s, si) {
          return (
            '<div class="activity-rubric-subject" data-reference="' +
            s.reference +
            '" data-note="' +
            esc(s.note || '') +
            '">' +
            '<p class="activity-rubric-label">' + esc(s.label) + '</p>' +
            '<div class="activity-rubric-inputs">' +
            criteria
              .map(function (c, ci) {
                return (
                  '<label class="activity-rubric-crit">' +
                  esc(c) +
                  '<input type="number" min="1" max="10" class="activity-rubric-input" />' +
                  '</label>'
                );
              })
              .join('') +
            '</div>' +
            '<p class="activity-rubric-compare" hidden></p>' +
            '</div>'
          );
        })
        .join('') +
      '</div>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="rubric">Compare to instructor</button>'
    );
  }

  function activityAllocatorHtml(lessonNum, activity) {
    if (activity.mode === 'calculator') {
      return (
        '<div class="activity-allocator" data-mode="calculator" data-formula="' +
        esc(activity.formula || '') +
        '">' +
        (activity.fields || [])
          .map(function (f) {
            if (f.type === 'select') {
              return (
                '<label class="activity-allocator-field">' +
                esc(f.label) +
                '<select class="activity-calc-input" data-key="' + esc(f.key) + '">' +
                (f.options || [])
                  .map(function (o) {
                    return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
                  })
                  .join('') +
                '</select>' +
                '</label>'
              );
            }
            return (
              '<label class="activity-allocator-field">' +
              esc(f.label) +
              '<input type="number" class="activity-calc-input" data-key="' +
              esc(f.key) +
              '" placeholder="' + esc(f.placeholder || '') + '" />' +
              '</label>'
            );
          })
          .join('') +
        '<button type="button" class="btn primary activity-check-btn" data-check="allocator-calc">Calculate</button>' +
        '<p class="activity-result" hidden></p>' +
        (activity.modelNote ? '<p class="activity-note">' + esc(activity.modelNote) + '</p>' : '') +
        '</div>'
      );
    }
    return (
      '<div class="activity-allocator" data-mode="budget" data-total="' + activity.total + '">' +
      (activity.items || [])
        .map(function (it) {
          return (
            '<label class="activity-allocator-row" data-suggested="' + it.suggested + '">' +
            '<span class="activity-allocator-label">' + esc(it.label) + '</span>' +
            '<input type="number" min="0" class="activity-allocator-input" value="0" />' +
            '</label>'
          );
        })
        .join('') +
      '<p class="activity-allocator-total">Total: <span class="activity-allocator-sum">0</span> / ' +
      activity.total +
      ' ' + esc(activity.unit || '') + '</p>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="allocator-budget">See a model allocation</button>' +
      '<p class="activity-result" hidden></p>' +
      '</div>'
    );
  }

  function activityChecklistHtml(lessonNum, activity) {
    var graded = !!activity.graded;
    var label = graded
      ? 'Check my picks'
      : activity.minRequired
        ? 'Check my list'
        : 'Mark complete';
    return (
      '<div class="activity-checklist" data-graded="' +
      graded +
      '" data-min-required="' +
      (activity.minRequired || '') +
      '" data-require-diversity="' +
      (activity.requireTagDiversity || '') +
      '">' +
      (activity.items || [])
        .map(function (it, i) {
          return (
            '<label class="activity-checklist-item" data-flag="' +
            (it.isFlag ? 'true' : 'false') +
            '" data-tag="' + esc(it.tag || '') + '">' +
            '<input type="checkbox" class="activity-checklist-input" />' +
            '<span>' + esc(it.text) + '</span>' +
            '</label>'
          );
        })
        .join('') +
      '<button type="button" class="btn primary activity-check-btn" data-check="checklist">' +
      esc(label) +
      '</button>' +
      '<p class="activity-result" hidden></p>' +
      '</div>'
    );
  }

  function activityBuilderHtml(lessonNum, activity) {
    return (
      '<div class="activity-builder">' +
      (activity.fields || [])
        .map(function (f) {
          return (
            '<div class="activity-builder-field">' +
            '<label class="activity-builder-label">' + esc(f.label) + '</label>' +
            '<textarea class="activity-builder-input" placeholder="' +
            esc(f.placeholder || '') +
            '"></textarea>' +
            '<p class="activity-builder-model" hidden>' + esc(f.model || '') + '</p>' +
            '</div>'
          );
        })
        .join('') +
      '<button type="button" class="btn primary activity-check-btn" data-check="builder">See a model answer</button>' +
      '</div>'
    );
  }

  var ACTIVITY_FORMULAS = {
    // Two base day-rates (already roughly at parity), each scaled by
    // experience multiplier and a mild per-extra-month usage bump.
    ugcRate: function (inputs) {
      var level = parseFloat(inputs.level) || 1;
      var months = Math.max(1, parseFloat(inputs.usageMonths) || 1);
      var usageMult = 1 + (months - 1) * 0.15;
      var baseGBP = 150;
      var baseUSD = 190;
      var singleGBP = Math.round(baseGBP * level * usageMult);
      var singleUSD = Math.round(baseUSD * level * usageMult);
      var bundleGBP = Math.round(singleGBP * 3 * 0.85);
      var bundleUSD = Math.round(singleUSD * 3 * 0.85);
      var retainerGBP = Math.round(singleGBP * 4 * 0.75);
      var retainerUSD = Math.round(singleUSD * 4 * 0.75);
      return (
        'Single video: £' + singleGBP + ' / $' + singleUSD +
        '.  3-video bundle: £' + bundleGBP + ' / $' + bundleUSD +
        '.  Monthly retainer (4 videos): £' + retainerGBP + ' / $' + retainerUSD + '.'
      );
    },
  };

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
      (lesson.activity ? activityHtml(lesson.num, lesson.activity) : '') +
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
      return;
    }

    // --- Activities ---
    var quizOpt = e.target.closest('.activity-quiz-opt');
    if (quizOpt) {
      var qWrap = quizOpt.closest('.activity-quiz-q');
      if (qWrap && !qWrap.classList.contains('is-answered')) {
        var correctIdx = Number(qWrap.getAttribute('data-correct'));
        var pickedIdx = Number(quizOpt.getAttribute('data-opt'));
        qWrap.classList.add('is-answered');
        qWrap.querySelectorAll('.activity-quiz-opt').forEach(function (btn, i) {
          btn.disabled = true;
          if (i === correctIdx) btn.classList.add('is-correct');
          else if (i === pickedIdx) btn.classList.add('is-wrong');
        });
        var explain = qWrap.querySelector('.activity-quiz-explain');
        if (explain) explain.hidden = false;
        var lessonNumQ = qWrap.closest('.activity').getAttribute('data-lesson');
        markActivityDone(lessonNumQ);
      }
      return;
    }

    var seqMove = e.target.closest('.activity-seq-move');
    if (seqMove) {
      var li = seqMove.closest('.activity-seq-item');
      var dir = seqMove.getAttribute('data-dir');
      var sibling = dir === 'up' ? li.previousElementSibling : li.nextElementSibling;
      if (sibling) {
        var list = li.parentElement;
        if (dir === 'up') list.insertBefore(li, sibling);
        else list.insertBefore(sibling, li);
      }
      return;
    }

    var checkBtn = e.target.closest('[data-check]');
    if (checkBtn) {
      var kind = checkBtn.getAttribute('data-check');
      var activityEl = checkBtn.closest('.activity');
      var lessonNumC = activityEl ? activityEl.getAttribute('data-lesson') : null;
      if (kind === 'sequence') checkSequence(checkBtn);
      else if (kind === 'match') checkMatch(checkBtn);
      else if (kind === 'rubric') checkRubric(checkBtn);
      else if (kind === 'allocator-budget') checkAllocatorBudget(checkBtn);
      else if (kind === 'allocator-calc') checkAllocatorCalc(checkBtn);
      else if (kind === 'checklist') checkChecklist(checkBtn);
      else if (kind === 'builder') checkBuilder(checkBtn);
      if (lessonNumC) markActivityDone(lessonNumC);
      return;
    }
  });

  document.addEventListener('input', function (e) {
    var allocInput = e.target.closest('.activity-allocator-input');
    if (allocInput) {
      var wrap = allocInput.closest('.activity-allocator');
      var sumEl = wrap.querySelector('.activity-allocator-sum');
      var total = Number(wrap.getAttribute('data-total')) || 0;
      var sum = 0;
      wrap.querySelectorAll('.activity-allocator-input').forEach(function (inp) {
        sum += Number(inp.value) || 0;
      });
      if (sumEl) sumEl.textContent = String(sum);
      wrap.classList.toggle('is-over-budget', sum > total);
    }
  });

  function checkSequence(btn) {
    var wrap = btn.closest('.activity');
    var list = wrap.querySelector('.activity-seq-list');
    var items = Array.prototype.slice.call(list.querySelectorAll('.activity-seq-item'));
    var target = Number(list.getAttribute('data-target')) || items.length;
    var rightCount = 0;
    items.forEach(function (li, pos) {
      var correctIdx = Number(li.getAttribute('data-correct-idx'));
      var mark = li.querySelector('.activity-seq-mark');
      li.classList.remove('is-correct', 'is-wrong');
      if (pos >= target) {
        if (mark) mark.innerHTML = '';
        return;
      }
      var right = target === items.length ? correctIdx === pos : correctIdx < target;
      if (right) {
        rightCount++;
        li.classList.add('is-correct');
        if (mark) mark.innerHTML = '&#10003;';
      } else {
        li.classList.add('is-wrong');
        if (mark) mark.innerHTML = '&#10007;';
      }
    });
    var result = wrap.querySelector('.activity-result');
    if (result) {
      result.hidden = false;
      result.textContent = rightCount + ' of ' + target + ' in the right spot.';
    }
  }

  function checkMatch(btn) {
    var wrap = btn.closest('.activity');
    var rows = wrap.querySelectorAll('.activity-match-row');
    var right = 0;
    rows.forEach(function (row) {
      var select = row.querySelector('.activity-match-select');
      var mark = row.querySelector('.activity-match-mark');
      var correct = row.getAttribute('data-correct');
      row.classList.remove('is-correct', 'is-wrong');
      if (select.value === '') {
        if (mark) mark.innerHTML = '';
        return;
      }
      if (select.value === correct) {
        right++;
        row.classList.add('is-correct');
        if (mark) mark.innerHTML = '&#10003;';
      } else {
        row.classList.add('is-wrong');
        if (mark) mark.innerHTML = '&#10007;';
      }
    });
    var result = wrap.querySelector('.activity-result');
    if (result) {
      result.hidden = false;
      result.textContent = right + ' of ' + rows.length + ' correct.';
    }
  }

  function checkRubric(btn) {
    var wrap = btn.closest('.activity');
    wrap.querySelectorAll('.activity-rubric-subject').forEach(function (subj) {
      var inputs = subj.querySelectorAll('.activity-rubric-input');
      var total = 0;
      inputs.forEach(function (inp) {
        total += Number(inp.value) || 0;
      });
      var reference = subj.getAttribute('data-reference');
      var note = subj.getAttribute('data-note');
      var compare = subj.querySelector('.activity-rubric-compare');
      if (compare) {
        compare.hidden = false;
        compare.textContent =
          'Your total: ' + total + '.  Instructor: ' + reference + '. ' + note;
      }
    });
  }

  function checkAllocatorBudget(btn) {
    var wrap = btn.closest('.activity-allocator');
    var rows = wrap.querySelectorAll('.activity-allocator-row');
    var lines = [];
    rows.forEach(function (row) {
      lines.push(row.querySelector('.activity-allocator-label').textContent + ': ' + row.getAttribute('data-suggested'));
    });
    var result = wrap.querySelector('.activity-result');
    if (result) {
      result.hidden = false;
      result.textContent = 'A model allocation — ' + lines.join(', ') + '.';
    }
  }

  function checkAllocatorCalc(btn) {
    var wrap = btn.closest('.activity-allocator');
    var formulaName = wrap.getAttribute('data-formula');
    var formula = ACTIVITY_FORMULAS[formulaName];
    var result = wrap.querySelector('.activity-result');
    if (!formula || !result) return;
    var inputs = {};
    wrap.querySelectorAll('.activity-calc-input').forEach(function (el) {
      inputs[el.getAttribute('data-key')] = el.value;
    });
    result.hidden = false;
    result.textContent = formula(inputs);
  }

  function checkChecklist(btn) {
    var wrap = btn.closest('.activity-checklist');
    var graded = wrap.getAttribute('data-graded') === 'true';
    var minRequired = Number(wrap.getAttribute('data-min-required')) || 0;
    var requireDiversity = Number(wrap.getAttribute('data-require-diversity')) || 0;
    var items = wrap.querySelectorAll('.activity-checklist-item');
    var result = wrap.querySelector('.activity-result');
    if (!result) return;
    result.hidden = false;

    if (graded) {
      var right = 0;
      items.forEach(function (item) {
        var checked = item.querySelector('.activity-checklist-input').checked;
        var isFlag = item.getAttribute('data-flag') === 'true';
        item.classList.remove('is-correct', 'is-wrong');
        if (checked === isFlag) {
          right++;
          item.classList.add('is-correct');
        } else {
          item.classList.add('is-wrong');
        }
      });
      result.textContent = right + ' of ' + items.length + ' judged correctly.';
      return;
    }

    var checkedCount = 0;
    var tags = {};
    items.forEach(function (item) {
      if (item.querySelector('.activity-checklist-input').checked) {
        checkedCount++;
        var tag = item.getAttribute('data-tag');
        if (tag) tags[tag] = true;
      }
    });

    if (minRequired && checkedCount < minRequired) {
      result.textContent = 'Pick at least ' + minRequired + ' — you have ' + checkedCount + ' so far.';
      return;
    }
    if (requireDiversity) {
      var distinct = Object.keys(tags).length;
      if (distinct < requireDiversity) {
        result.textContent =
          'You have ' + checkedCount + ', but only ' + distinct + ' angle type(s) — cover at least ' + requireDiversity + '.';
        return;
      }
      result.textContent = 'Nice — ' + checkedCount + ' shots across ' + distinct + ' angle types, that’s diverse enough.';
      return;
    }
    result.textContent = 'Marked complete — nice work.';
  }

  function checkBuilder(btn) {
    var wrap = btn.closest('.activity-builder');
    wrap.querySelectorAll('.activity-builder-model').forEach(function (p) {
      p.hidden = false;
    });
  }

  if (detailBack) {
    detailBack.addEventListener('click', function () {
      setView(lastListView);
    });
  }

  boot();
})();
