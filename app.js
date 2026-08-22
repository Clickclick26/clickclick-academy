/**
 * ClickClick Academy: pack-based access.
 * Access codes unlock a pack of course IDs. Hidden courses stay hidden (no lock teasers).
 * Not real auth, replace before wide public launch.
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
        'These are the courses in your pack. Other catalogues stay hidden.';
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
    // honest "Coming soon" badge instead of "Not started"; that copy
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

  // Flat, in-order list of every lesson's num across all modules, used to
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
  // State (answers/inputs/order + a "done" flag) is remembered per lesson in
  // localStorage, so leaving and coming back keeps exactly where a student
  // left off. It never gates the deliverable/unlock flow (that stays driven
  // by academy_progress); it's just not worth a server round trip. Each
  // widget also gets its own Reset button to clear and start over.
  var ACTIVITY_STATE_KEY = 'clickclick_academy_activity_v2';
  function loadActivityState() {
    try {
      var raw = localStorage.getItem(ACTIVITY_STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function getLessonActivityState(lessonNum) {
    return loadActivityState()[lessonNum] || {};
  }
  function saveLessonActivityState(lessonNum, patch) {
    var all = loadActivityState();
    var cur = all[lessonNum] || {};
    Object.keys(patch).forEach(function (k) {
      cur[k] = patch[k];
    });
    all[lessonNum] = cur;
    try {
      localStorage.setItem(ACTIVITY_STATE_KEY, JSON.stringify(all));
    } catch (e) {}
    return cur;
  }
  function clearLessonActivityState(lessonNum) {
    var all = loadActivityState();
    delete all[lessonNum];
    try {
      localStorage.setItem(ACTIVITY_STATE_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function markActivityDone(lessonNum) {
    saveLessonActivityState(lessonNum, { done: true });
    var badge = document.querySelector(
      '.activity[data-lesson="' + lessonNum + '"] .activity-done-badge'
    );
    if (badge) badge.hidden = false;
  }
  function findLessonByNum(course, num) {
    var mods = (course && course.modules) || [];
    for (var i = 0; i < mods.length; i++) {
      var lessons = mods[i].lessons || [];
      for (var j = 0; j < lessons.length; j++) {
        if (lessons[j].num === num) return lessons[j];
      }
    }
    return null;
  }

  // Looks up an activity config by its storage key, covering both real
  // lesson nums ("1.01") and the two bonus recap widgets ("bonus-wordbank",
  // "bonus-wheel") that live outside the module/lesson structure.
  function findActivityConfig(lessonNum) {
    if (lessonNum === 'bonus-wordbank') {
      return currentDetailCourse && currentDetailCourse.bonusActivities
        ? currentDetailCourse.bonusActivities.wordbank
        : null;
    }
    if (lessonNum === 'bonus-wheel') {
      return currentDetailCourse && currentDetailCourse.bonusActivities
        ? currentDetailCourse.bonusActivities.wheel
        : null;
    }
    var lesson = findLessonByNum(currentDetailCourse, lessonNum);
    return lesson ? lesson.activity : null;
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

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Small, dependency-free confetti burst: a canvas overlaid on the whole
  // viewport, particles drawn from the origin element's position, gravity'd
  // and faded out over ~1s, then the canvas removes itself. No-ops under
  // prefers-reduced-motion.
  var CONFETTI_COLORS = ['#00bcd4', '#7b5ea7', '#e83e8c', '#f5a623', '#22c55e'];
  function launchConfetti(originEl, opts) {
    if (prefersReducedMotion()) return;
    opts = opts || {};
    var count = opts.count || 36;
    var rect = originEl && originEl.getBoundingClientRect
      ? originEl.getBoundingClientRect()
      : { left: window.innerWidth / 2, top: window.innerHeight / 3, width: 0, height: 0 };
    var originX = rect.left + rect.width / 2;
    var originY = rect.top + Math.min(rect.height, 40) / 2;

    var canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    var dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var particles = [];
    for (var i = 0; i < count; i++) {
      particles.push({
        x: originX,
        y: originY,
        vx: (Math.random() - 0.5) * (opts.spread || 9),
        vy: -(Math.random() * 6 + 4),
        size: Math.random() * 6 + 4,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 22,
        life: 0,
        maxLife: 55 + Math.random() * 30,
      });
    }

    var gravity = 0.25;
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var alive = false;
      particles.forEach(function (p) {
        if (p.life >= p.maxLife) return;
        alive = true;
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.life++;
        var alpha = Math.max(1 - p.life / p.maxLife, 0);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });
      if (alive) {
        requestAnimationFrame(frame);
      } else {
        canvas.remove();
      }
    }
    requestAnimationFrame(frame);
  }

  // Fires a quick pop/shake on an element without fighting a re-trigger;
  // removing the class first forces the animation to restart if called twice.
  function playFeedback(el, cls) {
    if (!el || prefersReducedMotion()) return;
    el.classList.remove('anim-pop', 'anim-shake');
    void el.offsetWidth; // reflow, so re-adding the class restarts the animation
    el.classList.add(cls);
  }

  function activityHtml(lessonNum, activity) {
    var state = getLessonActivityState(lessonNum);
    var body;
    switch (activity.kind) {
      case 'quiz':
        body = activityQuizHtml(lessonNum, activity, state);
        break;
      case 'sequence':
        body = activitySequenceHtml(lessonNum, activity, state);
        break;
      case 'match':
        body = activityMatchHtml(lessonNum, activity, state);
        break;
      case 'rubric':
        body = activityRubricHtml(lessonNum, activity, state);
        break;
      case 'allocator':
        body = activityAllocatorHtml(lessonNum, activity, state);
        break;
      case 'checklist':
        body = activityChecklistHtml(lessonNum, activity, state);
        break;
      case 'builder':
        body = activityBuilderHtml(lessonNum, activity, state);
        break;
      case 'wordbank':
        body = activityWordbankHtml(lessonNum, activity, state);
        break;
      case 'wheel':
        body = activityWheelHtml(lessonNum, activity, state);
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
      (state.done ? '' : ' hidden') +
      '>&#10003; done</span>' +
      '<button type="button" class="activity-reset-btn" data-lesson="' +
      esc(lessonNum) +
      '">Reset</button>' +
      '</div>' +
      (activity.prompt ? '<p class="activity-prompt">' + esc(activity.prompt) + '</p>' : '') +
      body +
      '</div>'
    );
  }

  function activityQuizHtml(lessonNum, activity, state) {
    var answers = state.answers || {};
    return (activity.questions || [])
      .map(function (q, qi) {
        var picked = answers[qi];
        var answered = picked !== undefined && picked !== null;
        return (
          '<div class="activity-quiz-q' +
          (answered ? ' is-answered' : '') +
          '" data-correct="' +
          q.correct +
          '">' +
          '<p class="activity-quiz-question">' + esc(q.q) + '</p>' +
          '<div class="activity-quiz-options">' +
          q.options
            .map(function (opt, oi) {
              var cls = 'activity-quiz-opt';
              if (answered) {
                if (oi === q.correct) cls += ' is-correct';
                else if (oi === picked) cls += ' is-wrong';
              }
              return (
                '<button type="button" class="' + cls + '" data-opt="' + oi + '"' +
                (answered ? ' disabled' : '') +
                '>' + esc(opt) + '</button>'
              );
            })
            .join('') +
          '</div>' +
          '<p class="activity-quiz-explain"' + (answered ? '' : ' hidden') + '>' +
          esc(q.explain || '') + '</p>' +
          '</div>'
        );
      })
      .join('');
  }

  // Order-correctness is a pure function of (order, target) so the check
  // button and a page-load rehydrate always agree.
  function sequenceMarks(order, target) {
    return order.map(function (correctIdx, pos) {
      if (pos >= target) return null;
      return target === order.length ? correctIdx === pos : correctIdx < target;
    });
  }

  function activitySequenceHtml(lessonNum, activity, state) {
    var items = activity.items || [];
    var target = activity.topN || items.length;
    var order = state.order && state.order.length === items.length ? state.order : null;
    if (!order) {
      order = shuffled(items.map(function (text, i) { return i; }));
      // Re-shuffle once if it happened to land in the exact correct order;
      // otherwise the exercise is trivially "already right."
      var isExact = order.every(function (v, i) { return v === i; });
      if (isExact && items.length > 1) {
        var a = order[0];
        order[0] = order[1];
        order[1] = a;
      }
      saveLessonActivityState(lessonNum, { order: order });
    }
    var marks = state.checked ? sequenceMarks(order, target) : null;
    var rightCount = marks ? marks.filter(function (m) { return m === true; }).length : 0;
    return (
      '<ol class="activity-seq-list" data-target="' + target + '">' +
      order
        .map(function (origIdx, pos) {
          var mark = marks ? marks[pos] : null;
          var cls = 'activity-seq-item' + (mark === true ? ' is-correct' : mark === false ? ' is-wrong' : '');
          var markHtml = mark === true ? '&#10003;' : mark === false ? '&#10007;' : '';
          return (
            '<li class="' + cls + '" data-correct-idx="' + origIdx + '">' +
            '<span class="activity-seq-text">' + esc(items[origIdx]) + '</span>' +
            '<span class="activity-seq-controls">' +
            '<button type="button" class="activity-seq-move" data-dir="up" aria-label="Move up">&#8593;</button>' +
            '<button type="button" class="activity-seq-move" data-dir="down" aria-label="Move down">&#8595;</button>' +
            '</span>' +
            '<span class="activity-seq-mark">' + markHtml + '</span>' +
            '</li>'
          );
        })
        .join('') +
      '</ol>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="sequence">Check order</button>' +
      '<p class="activity-result"' + (state.checked ? '' : ' hidden') + '>' +
      (state.checked ? rightCount + ' of ' + target + ' in the right spot.' : '') +
      '</p>'
    );
  }

  function activityMatchHtml(lessonNum, activity, state) {
    var categories = activity.categories || [];
    var selections = state.selections || {};
    var right = 0;
    var answeredCount = 0;
    var rowsHtml = (activity.items || [])
      .map(function (item, ri) {
        var val = selections[ri];
        var hasVal = val !== undefined && val !== null && val !== '';
        var isRight = hasVal && String(val) === String(item.correct);
        if (state.checked && hasVal) {
          answeredCount++;
          if (isRight) right++;
        }
        var cls =
          'activity-match-row' +
          (state.checked && hasVal ? (isRight ? ' is-correct' : ' is-wrong') : '');
        var markHtml = state.checked && hasVal ? (isRight ? '&#10003;' : '&#10007;') : '';
        return (
          '<div class="' + cls + '" data-correct="' + item.correct + '">' +
          '<span class="activity-match-label">' + esc(item.label) + '</span>' +
          '<select class="activity-match-select">' +
          '<option value="">Choose…</option>' +
          categories
            .map(function (cat, ci) {
              return (
                '<option value="' + ci + '"' +
                (hasVal && String(val) === String(ci) ? ' selected' : '') +
                '>' + esc(cat) + '</option>'
              );
            })
            .join('') +
          '</select>' +
          '<span class="activity-match-mark">' + markHtml + '</span>' +
          '</div>'
        );
      })
      .join('');
    var total = (activity.items || []).length;
    return (
      '<div class="activity-match">' + rowsHtml + '</div>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="match">Check answers</button>' +
      '<p class="activity-result"' + (state.checked ? '' : ' hidden') + '>' +
      (state.checked ? right + ' of ' + total + ' correct.' : '') +
      '</p>'
    );
  }

  function activityRubricHtml(lessonNum, activity, state) {
    // Criteria can be plain strings (old shape) or { label, hint } objects;
    // the hint renders as a small line under the label so a criterion like
    // "Hookiness" isn't just left for the student to guess the meaning of.
    var criteria = activity.criteria || [];
    var maxTotal = criteria.length * 10;
    var scores = state.scores || {};
    return (
      '<div class="activity-rubric">' +
      (activity.subjects || [])
        .map(function (s, si) {
          var subjScores = scores[si] || {};
          var subjTotal = 0;
          var inputsHtml = criteria
            .map(function (c, ci) {
              var v = subjScores[ci];
              subjTotal += Number(v) || 0;
              var label = typeof c === 'string' ? c : c.label;
              var hint = typeof c === 'string' ? '' : c.hint;
              return (
                '<label class="activity-rubric-crit">' +
                esc(label) +
                (hint ? '<span class="activity-rubric-hint">' + esc(hint) + '</span>' : '') +
                '<input type="number" min="1" max="10" class="activity-rubric-input"' +
                (v !== undefined && v !== null && v !== '' ? ' value="' + esc(v) + '"' : '') +
                ' />' +
                '</label>'
              );
            })
            .join('');
          var compareHtml = state.compared
            ? 'Your score: ' + subjTotal + ' out of ' + maxTotal + '.  Ours: ' + s.reference +
              ' out of ' + maxTotal + '. ' + esc(s.note || '')
            : '';
          return (
            '<div class="activity-rubric-subject" data-reference="' +
            s.reference +
            '" data-note="' +
            esc(s.note || '') +
            '">' +
            '<p class="activity-rubric-label">' + esc(s.label) + '</p>' +
            (s.video ? lessonVideoHtml(s.video) : '') +
            '<div class="activity-rubric-inputs">' + inputsHtml + '</div>' +
            '<p class="activity-rubric-compare"' + (state.compared ? '' : ' hidden') + '>' +
            compareHtml +
            '</p>' +
            '</div>'
          );
        })
        .join('') +
      '</div>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="rubric">Compare to our scores</button>'
    );
  }

  function activityAllocatorHtml(lessonNum, activity, state) {
    if (activity.mode === 'calculator') {
      var inputs = state.inputs || {};
      var calcResult = state.calculated ? ACTIVITY_FORMULAS[activity.formula](inputs) : '';
      return (
        '<div class="activity-allocator" data-mode="calculator" data-formula="' +
        esc(activity.formula || '') +
        '">' +
        (activity.fields || [])
          .map(function (f) {
            var v = inputs[f.key];
            if (f.type === 'select') {
              return (
                '<label class="activity-allocator-field">' +
                esc(f.label) +
                '<select class="activity-calc-input" data-key="' + esc(f.key) + '">' +
                (f.options || [])
                  .map(function (o) {
                    return (
                      '<option value="' + esc(o.value) + '"' +
                      (v !== undefined && String(v) === String(o.value) ? ' selected' : '') +
                      '>' + esc(o.label) + '</option>'
                    );
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
              '" placeholder="' + esc(f.placeholder || '') + '"' +
              (v !== undefined && v !== null && v !== '' ? ' value="' + esc(v) + '"' : '') +
              ' />' +
              '</label>'
            );
          })
          .join('') +
        '<button type="button" class="btn primary activity-check-btn" data-check="allocator-calc">Calculate</button>' +
        '<p class="activity-result"' + (state.calculated ? '' : ' hidden') + '>' + esc(calcResult) + '</p>' +
        (activity.modelNote ? '<p class="activity-note">' + esc(activity.modelNote) + '</p>' : '') +
        '</div>'
      );
    }
    var values = state.values || {};
    var sum = 0;
    var rowsHtml = (activity.items || [])
      .map(function (it, ri) {
        var v = values[ri];
        sum += Number(v) || 0;
        return (
          '<label class="activity-allocator-row" data-suggested="' + it.suggested + '">' +
          '<span class="activity-allocator-label">' + esc(it.label) + '</span>' +
          '<input type="number" min="0" class="activity-allocator-input" value="' +
          (v !== undefined && v !== null && v !== '' ? esc(v) : '0') +
          '" />' +
          '</label>'
        );
      })
      .join('');
    var lines = (activity.items || [])
      .map(function (it) {
        return it.label + ': ' + it.suggested;
      })
      .join(', ');
    return (
      '<div class="activity-allocator' + (sum > activity.total ? ' is-over-budget' : '') +
      '" data-mode="budget" data-total="' + activity.total + '">' +
      rowsHtml +
      '<p class="activity-allocator-total">Total: <span class="activity-allocator-sum">' + sum +
      '</span> / ' + activity.total + ' ' + esc(activity.unit || '') + '</p>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="allocator-budget">See a model allocation</button>' +
      '<p class="activity-result"' + (state.revealed ? '' : ' hidden') + '>' +
      (state.revealed ? 'A model allocation: ' + esc(lines) + '.' : '') +
      '</p>' +
      '</div>'
    );
  }

  function activityChecklistHtml(lessonNum, activity, state) {
    var graded = !!activity.graded;
    var checked = state.checked || {};
    var label = graded
      ? 'Check my picks'
      : activity.minRequired
        ? 'Check my list'
        : 'Mark complete';
    var itemsHtml = (activity.items || [])
      .map(function (it, i) {
        var isChecked = !!checked[i];
        var isFlag = !!it.isFlag;
        var cls = 'activity-checklist-item';
        if (graded && state.submitted) {
          cls += isChecked === isFlag ? ' is-correct' : ' is-wrong';
        }
        return (
          '<label class="' + cls + '" data-flag="' + isFlag + '" data-tag="' + esc(it.tag || '') + '">' +
          '<input type="checkbox" class="activity-checklist-input"' + (isChecked ? ' checked' : '') + ' />' +
          '<span>' + esc(it.text) + '</span>' +
          '</label>'
        );
      })
      .join('');
    var resultText = '';
    if (state.submitted) resultText = checklistResultText(activity, checked);
    return (
      '<div class="activity-checklist" data-graded="' + graded + '" data-min-required="' +
      (activity.minRequired || '') + '" data-require-diversity="' + (activity.requireTagDiversity || '') + '">' +
      itemsHtml +
      '<button type="button" class="btn primary activity-check-btn" data-check="checklist">' + esc(label) + '</button>' +
      '<p class="activity-result"' + (state.submitted ? '' : ' hidden') + '>' + esc(resultText) + '</p>' +
      '</div>'
    );
  }

  // Shared by render (rehydrate) and the click handler so both agree.
  function checklistResultText(activity, checkedMap) {
    var items = activity.items || [];
    if (activity.graded) {
      var right = 0;
      items.forEach(function (it, i) {
        if (!!checkedMap[i] === !!it.isFlag) right++;
      });
      return right + ' of ' + items.length + ' judged correctly.';
    }
    var checkedCount = 0;
    var tags = {};
    items.forEach(function (it, i) {
      if (checkedMap[i]) {
        checkedCount++;
        if (it.tag) tags[it.tag] = true;
      }
    });
    var minRequired = activity.minRequired || 0;
    var requireDiversity = activity.requireTagDiversity || 0;
    if (minRequired && checkedCount < minRequired) {
      return 'Pick at least ' + minRequired + '. You have ' + checkedCount + ' so far.';
    }
    if (requireDiversity) {
      var distinct = Object.keys(tags).length;
      if (distinct < requireDiversity) {
        return 'You have ' + checkedCount + ', but only ' + distinct + ' angle type(s). Cover at least ' + requireDiversity + '.';
      }
      return 'Nice, ' + checkedCount + ' shots across ' + distinct + ' angle types, that’s diverse enough.';
    }
    return 'Marked complete. Nice work.';
  }

  // True when the checklist reached a genuine "win" state: every flag
  // found with no false alarms (graded), or the count/diversity bar was
  // cleared (ungraded), used to decide whether it earns a confetti burst.
  function checklistSucceeded(activity, checkedMap) {
    var items = activity.items || [];
    if (activity.graded) {
      return items.every(function (it, i) { return !!checkedMap[i] === !!it.isFlag; });
    }
    var checkedCount = 0;
    var tags = {};
    items.forEach(function (it, i) {
      if (checkedMap[i]) {
        checkedCount++;
        if (it.tag) tags[it.tag] = true;
      }
    });
    if (activity.minRequired && checkedCount < activity.minRequired) return false;
    if (activity.requireTagDiversity && Object.keys(tags).length < activity.requireTagDiversity) return false;
    return true;
  }

  function activityBuilderHtml(lessonNum, activity, state) {
    var values = state.values || {};
    return (
      '<div class="activity-builder">' +
      (activity.fields || [])
        .map(function (f, fi) {
          var v = values[fi] || '';
          return (
            '<div class="activity-builder-field">' +
            '<label class="activity-builder-label">' + esc(f.label) + '</label>' +
            '<textarea class="activity-builder-input" placeholder="' + esc(f.placeholder || '') + '">' +
            esc(v) +
            '</textarea>' +
            '<p class="activity-builder-model"' + (state.revealed ? '' : ' hidden') + '>' + esc(f.model || '') + '</p>' +
            '</div>'
          );
        })
        .join('') +
      '<button type="button" class="btn primary activity-check-btn" data-check="builder">See a model answer</button>' +
      '</div>'
    );
  }

  // Word bank: a templated paragraph with {n} blanks, filled by clicking or
  // dragging chips from a shared bank (blanks + distractors, shuffled once
  // and persisted like sequence's order so a reload doesn't reshuffle mid-go).
  function activityWordbankHtml(lessonNum, activity, state) {
    var bankWords = (activity.blanks || []).concat(activity.distractors || []);
    var bankOrder = state.bankOrder && state.bankOrder.length === bankWords.length ? state.bankOrder : null;
    if (!bankOrder) {
      bankOrder = shuffled(bankWords.map(function (w, i) { return i; }));
      saveLessonActivityState(lessonNum, { bankOrder: bankOrder });
    }
    var filled = state.filled || {};
    var usedChipIdx = {};
    Object.keys(filled).forEach(function (bi) {
      usedChipIdx[filled[bi]] = true;
    });
    var blankCount = (activity.blanks || []).length;

    var sentenceHtml = String(activity.template || '').replace(/\{(\d+)\}/g, function (m, idxStr) {
      var bi = Number(idxStr);
      var chipIdx = filled[bi];
      var hasWord = chipIdx !== undefined && chipIdx !== null;
      var word = hasWord ? bankWords[bankOrder[chipIdx]] : '';
      var correctness = '';
      if (state.checked && hasWord) {
        correctness = word === activity.blanks[bi] ? ' is-correct' : ' is-wrong';
      }
      return (
        '<span class="wb-blank' + correctness + '" data-blank="' + bi + '">' +
        (hasWord ? esc(word) : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;') +
        '</span>'
      );
    });

    var bankHtml = bankOrder
      .map(function (wordIdx, chipIdx) {
        var used = !!usedChipIdx[chipIdx];
        return (
          '<button type="button" class="wb-chip' + (used ? ' is-used' : '') + '" data-chip="' + chipIdx + '"' +
          (used ? ' disabled' : '') +
          '>' + esc(bankWords[wordIdx]) + '</button>'
        );
      })
      .join('');

    var filledCount = Object.keys(filled).length;
    var right = 0;
    if (state.checked) {
      Object.keys(filled).forEach(function (bi) {
        if (bankWords[bankOrder[filled[bi]]] === activity.blanks[Number(bi)]) right++;
      });
    }

    return (
      '<div class="activity-wordbank" data-blank-count="' + blankCount + '">' +
      '<p class="wb-sentence">' + sentenceHtml + '</p>' +
      '<div class="wb-bank">' + bankHtml + '</div>' +
      '<button type="button" class="btn primary activity-check-btn" data-check="wordbank"' +
      (filledCount < blankCount ? ' disabled' : '') +
      '>Check answers</button>' +
      '<p class="activity-result"' + (state.checked ? '' : ' hidden') + '>' +
      (state.checked ? right + ' of ' + blankCount + ' correct.' : '') +
      '</p>' +
      '</div>'
    );
  }

  // Spin the wheel: a CSS conic-gradient dial with radially-placed labels,
  // spun via an accumulated rotation (so each spin continues smoothly from
  // wherever it last stopped rather than snapping back to 0). Landing on a
  // segment reveals that segment's quiz question, answered the same way a
  // normal quiz question is (instant reveal + pop/shake + confetti).
  //
  // The spin isn't pure chance: pickWheelIndex() only draws from topics not
  // yet answered correctly, so every spin makes real progress toward
  // clearing all of them, and a wrong answer keeps that topic in the pool
  // instead of moving on. Once all are cleared it becomes a free replay.
  var WHEEL_COLORS = [
    '#00bcd4', '#7b5ea7', '#e83e8c', '#f5a623', '#22c55e',
    '#c2185b', '#0891b2', '#f97316', '#6366f1', '#65a30d',
  ];

  // A topic is "mastered" once its currently-recorded answer is correct
  // against the specific question it was recorded against (each landing
  // can draw a different question from that topic's pool).
  function wheelTopicMastered(topic, entry) {
    if (!entry || entry.qIdx === undefined) return false;
    var q = topic.questions && topic.questions[entry.qIdx];
    return !!q && entry.picked === q.correct;
  }

  function wheelMasteredCount(segments, answered) {
    answered = answered || {};
    var n = 0;
    segments.forEach(function (s, i) {
      if (wheelTopicMastered(s, answered[i])) n++;
    });
    return n;
  }

  function pickWheelIndex(segments, answered) {
    answered = answered || {};
    var pool = [];
    segments.forEach(function (s, i) {
      if (!wheelTopicMastered(s, answered[i])) pool.push(i);
    });
    if (!pool.length) pool = segments.map(function (s, i) { return i; });
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function activityWheelHtml(lessonNum, activity, state) {
    var segments = activity.segments || [];
    var n = segments.length;
    var seg = 360 / n;
    var rotation = state.rotation || 0;
    var answeredMap = state.answered || {};
    var mastered = wheelMasteredCount(segments, answeredMap);
    var gradientStops = segments
      .map(function (s, i) {
        var color = WHEEL_COLORS[i % WHEEL_COLORS.length];
        return color + ' ' + i * seg + 'deg ' + (i + 1) * seg + 'deg';
      })
      .join(', ');
    var labelsHtml = segments
      .map(function (s, i) {
        var center = i * seg + seg / 2;
        // The label's parent is the dial itself, which carries the
        // accumulated spin (rotation, often several thousand degrees after
        // a few spins), so the inner span has to counter-rotate against that
        // too, not just its own segment angle, or it lands sideways/upside
        // down once the dial has spun past its first rest position.
        return (
          '<span class="wheel-label" style="transform: translate(-50%, -50%) rotate(' + center + 'deg) translateY(-100px)">' +
          '<span style="display:inline-block; transform: rotate(' + -(center + rotation) + 'deg)">' + esc(s.label) + '</span>' +
          '</span>'
        );
      })
      .join('');

    var landedIndex = state.landedIndex;
    var hasLanded = landedIndex !== undefined && landedIndex !== null;
    var topic = hasLanded ? segments[landedIndex] : null;
    var qIdx = state.landedQuestionIdx || 0;
    var question = topic ? topic.questions[qIdx] : null;
    var answeredEntry = hasLanded ? answeredMap[landedIndex] : null;
    var answered = !!(answeredEntry && answeredEntry.qIdx === qIdx);
    var pickedIdx = answered ? answeredEntry.picked : null;

    var resultHtml = '';
    if (hasLanded && topic && question) {
      resultHtml =
        '<div class="wheel-question" data-seg="' + landedIndex + '" data-q="' + qIdx + '">' +
        '<p class="wheel-question-label">' + esc(topic.label) + '</p>' +
        '<p class="activity-quiz-question">' + esc(question.q) + '</p>' +
        '<div class="activity-quiz-options">' +
        question.options
          .map(function (opt, oi) {
            var cls = 'activity-quiz-opt';
            if (answered) {
              if (oi === question.correct) cls += ' is-correct';
              else if (oi === pickedIdx) cls += ' is-wrong';
            }
            return (
              '<button type="button" class="' + cls + '" data-wheel-opt="' + oi + '"' +
              (answered ? ' disabled' : '') +
              '>' + esc(opt) + '</button>'
            );
          })
          .join('') +
        '</div>' +
        '<p class="activity-quiz-explain"' + (answered ? '' : ' hidden') + '>' + esc(question.explain || '') + '</p>' +
        '</div>';
    }

    return (
      '<div class="activity-wheel">' +
      '<p class="wheel-progress">' + mastered + ' of ' + n + ' topics nailed' +
      (mastered >= n ? ' &#127881; all cleared, spin away for fun' : '') + '</p>' +
      '<div class="wheel-stage">' +
      '<div class="wheel-pointer"></div>' +
      '<div class="wheel-dial" data-rotation="' + rotation + '" style="transform: rotate(' + rotation +
      'deg); background: conic-gradient(' + gradientStops + ')">' +
      labelsHtml +
      '</div>' +
      '</div>' +
      '<button type="button" class="btn primary activity-wheel-spin-btn">Spin the wheel</button>' +
      resultHtml +
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

  // Turns a pasted YouTube, Vimeo, or Instagram Reel/post link into a
  // responsive embed. Anything else (blank, or a URL we don't recognize)
  // just renders nothing, so a lesson with no video yet looks exactly like
  // it did before this existed.
  function lessonVideoEmbedSrc(url) {
    if (!url) return null;
    var s = String(url).trim();
    var yt = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
    if (yt) return { platform: 'youtube', src: 'https://www.youtube.com/embed/' + yt[1] };
    var vimeo = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeo) return { platform: 'vimeo', src: 'https://player.vimeo.com/video/' + vimeo[1] };
    // Instagram only serves an embeddable player off the singular "/reel/"
    // path, so "/reels/" and "/p/" links both get normalized to it.
    var ig = s.match(/instagram\.com\/(?:reel|reels|p)\/([a-zA-Z0-9_-]+)/);
    if (ig) return { platform: 'instagram', src: 'https://www.instagram.com/reel/' + ig[1] + '/embed' };
    return null;
  }

  function lessonVideoHtml(video) {
    var info = lessonVideoEmbedSrc(video);
    if (!info) return '';
    var cls = info.platform === 'instagram' ? 'lesson-video lesson-video--instagram' : 'lesson-video';
    return (
      '<div class="' + cls + '">' +
      '<iframe src="' + esc(info.src) + '" title="Lesson video" loading="lazy" allowfullscreen ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>' +
      '</div>'
    );
  }

  // A fake, clearly-illustrative DM screenshot pair (bad pitch vs good pitch,
  // or any two-message contrast) for lessons that need a visual example but
  // have no real real-world screenshot to show. Never render real people's
  // private messages here, this is a mockup, styled generically so it
  // doesn't pretend to be any specific app's real UI.
  function dmMockupHtml(mockup) {
    if (!mockup || !mockup.bad || !mockup.good) return '';
    function bubble(kind, tag, name, text) {
      return (
        '<div class="dm-mockup dm-mockup--' + kind + '">' +
        '<span class="dm-mockup-tag dm-mockup-tag--' + kind + '">' + esc(tag) + '</span>' +
        '<div class="dm-mockup-header">' +
        '<span class="dm-mockup-avatar" aria-hidden="true"></span>' +
        '<span class="dm-mockup-name">' + esc(name) + '</span>' +
        '</div>' +
        '<div class="dm-mockup-bubble">' + esc(text) + '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="dm-mockup-pair">' +
      bubble('bad', 'Gets ignored', mockup.badName || 'Local Brand', mockup.bad) +
      bubble('good', 'Gets a reply', mockup.goodName || 'Local Brand', mockup.good) +
      '</div>'
    );
  }

  function lessonHtml(lesson, state, justUnlockedNum) {
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

    var justUnlocked = state === 'open' && lesson.num === justUnlockedNum;
    return (
      '<article class="lesson-card lesson-card--' + state +
      (justUnlocked ? ' lesson-card--just-unlocked' : '') +
      '" data-num="' + esc(lesson.num || '') + '">' +
      '<div class="lesson-card-head">' +
      '<span class="lesson-num">' + esc(lesson.num || '') + '</span>' +
      '<h4>' + esc(lesson.title || '') + '</h4>' +
      statusBadge +
      '</div>' +
      lessonVideoHtml(lesson.video) +
      (lesson.overview ? '<p class="lesson-overview">' + esc(lesson.overview) + '</p>' : '') +
      dmMockupHtml(lesson.dmMockup) +
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

  function moduleHtml(mod, index, submittedByNum, justUnlockedNum) {
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
          return lessonHtml(lesson, lessonState(lesson, submittedByNum), justUnlockedNum);
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

  function courseDetailHtml(course, submittedByNum, justUnlockedNum) {
    var modules = Array.isArray(course.modules) ? course.modules : [];
    var lessonCount = modules.reduce(function (n, m) {
      return n + (Array.isArray(m.lessons) ? m.lessons.length : 0);
    }, 0);
    var doneCount = Object.keys(submittedByNum).length;
    currentAllNums = flatLessonNums(course);
    var complete = lessonCount > 0 && doneCount >= lessonCount;
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
      '<div class="progress-track" role="progressbar" aria-valuenow="' + doneCount +
      '" aria-valuemin="0" aria-valuemax="' + lessonCount + '"><div class="progress-fill"></div></div>' +
      (complete
        ? '<p class="course-complete-banner">&#127881; Every lesson done. That\'s the whole certification. Nice work.</p>'
        : '') +
      '</div>' +
      modules.map(function (m, i) { return moduleHtml(m, i, submittedByNum, justUnlockedNum); }).join('') +
      bonusActivitiesHtml(course)
    );
  }

  // Two recap games pulling from across the whole course, always playable,
  // no unlock-gating or deliverable involved (they're just for fun).
  function bonusActivitiesHtml(course) {
    var bonus = course.bonusActivities;
    if (!bonus) return '';
    var cards = [];
    if (bonus.wordbank) {
      cards.push(
        '<article class="lesson-card lesson-card--bonus">' +
        '<div class="lesson-card-head"><h4>Fill in the blanks</h4></div>' +
        activityHtml('bonus-wordbank', bonus.wordbank) +
        '</article>'
      );
    }
    if (bonus.wheel) {
      cards.push(
        '<article class="lesson-card lesson-card--bonus">' +
        '<div class="lesson-card-head"><h4>Spin the wheel</h4></div>' +
        activityHtml('bonus-wheel', bonus.wheel) +
        '</article>'
      );
    }
    if (!cards.length) return '';
    return (
      '<section class="module-block">' +
      '<div class="module-block-head">' +
      '<span class="module-block-num">Bonus</span>' +
      '<h3>Quick review</h3>' +
      '</div>' +
      '<p class="module-block-frame">Two fast recap games pulling from everything above. Nothing to unlock, just for fun.</p>' +
      cards.join('') +
      '</section>'
    );
  }

  // Runs the width from 0 to its real percentage on a rAF tick after mount,
  // so the fill always animates in, including on a plain page load.
  function animateProgressBar(doneCount, lessonCount) {
    var fill = detailBody.querySelector('.progress-fill');
    if (!fill) return;
    var pct = lessonCount ? Math.round((doneCount / lessonCount) * 100) : 0;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        fill.style.width = pct + '%';
      });
    });
  }

  function identifyGateHtml(course) {
    return (
      '<div class="detail-head detail-identify">' +
      '<span class="course-tag">' + esc(course.tag || '') + '</span>' +
      '<h1>' + esc(course.title || '') + '</h1>' +
      (course.description ? '<p class="detail-lead">' + esc(course.description) + '</p>' : '') +
      '<p class="detail-lead">Tell us who you are so your progress is saved: each lesson unlocks the next once you submit its deliverable.</p>' +
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

  function renderProgress(course, opts) {
    opts = opts || {};
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
                errEl.textContent = err.message || 'Could not save that. Try again.';
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
        detailBody.innerHTML = courseDetailHtml(course, byNum, opts.justUnlockedNum);
        var lessonCount = flatLessonNums(course).length;
        var doneCount = Object.keys(byNum).length;
        animateProgressBar(doneCount, lessonCount);
        if (opts.justSubmittedNum) {
          if (lessonCount > 0 && doneCount >= lessonCount) {
            launchConfetti(detailBody.querySelector('.course-complete-banner'), { count: 100, spread: 12 });
          } else {
            var submittedCard = detailBody.querySelector('.lesson-card[data-num="' + opts.justSubmittedNum + '"]');
            if (submittedCard) launchConfetti(submittedCard, { count: 40 });
          }
        }
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
            if (!res.ok) throw new Error('File upload failed. Try again.');
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
        var idx = currentAllNums.indexOf(lessonNum);
        var nextNum = idx >= 0 && idx < currentAllNums.length - 1 ? currentAllNums[idx + 1] : null;
        renderProgress(currentDetailCourse, { justSubmittedNum: lessonNum, justUnlockedNum: nextNum });
      })
      .catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Submit & unlock next';
        }
        if (errEl) {
          errEl.textContent = err.message || 'Could not submit. Try again.';
          errEl.hidden = false;
        }
      });
  }

  // Groups by tag, preserving first-seen order, so a mixed pack (mainly the
  // internal/admin one, which sees every audience at once) reads as
  // sections instead of one flat 21-card wall. A single-audience pack
  // (what every real customer actually has) only ever has one group, so
  // this renders as a plain grid for them, no redundant lone header.
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
      // Re-render this lesson as its open (form) state so they can redo it;
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
            animateProgressBar(Object.keys(byNum).length, flatLessonNums(currentDetailCourse).length);
          });
      }
      return;
    }

    // --- Activities ---
    var resetBtn = e.target.closest('.activity-reset-btn');
    if (resetBtn) {
      var resetNum = resetBtn.getAttribute('data-lesson');
      clearLessonActivityState(resetNum);
      var resetCfg = findActivityConfig(resetNum);
      var oldEl = document.querySelector('.activity[data-lesson="' + resetNum + '"]');
      if (resetCfg && oldEl) {
        oldEl.outerHTML = activityHtml(resetNum, resetCfg);
      }
      return;
    }

    // Wheel-question options reuse .activity-quiz-opt for identical styling
    // but live under .wheel-question, not .activity-quiz-q. Only handle
    // the click here when it's an actual quiz question, so a wheel answer
    // falls through to its own handler further down instead of being
    // silently swallowed by this early return.
    var quizOpt = e.target.closest('.activity-quiz-opt');
    if (quizOpt && quizOpt.closest('.activity-quiz-q')) {
      var qWrap = quizOpt.closest('.activity-quiz-q');
      if (!qWrap.classList.contains('is-answered')) {
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
        if (pickedIdx === correctIdx) {
          playFeedback(quizOpt, 'anim-pop');
          launchConfetti(quizOpt, { count: 16, spread: 6 });
        } else {
          playFeedback(quizOpt, 'anim-shake');
        }
        var lessonNumQ = qWrap.closest('.activity').getAttribute('data-lesson');
        var qAll = qWrap.closest('.activity').querySelectorAll('.activity-quiz-q');
        var qi = Array.prototype.indexOf.call(qAll, qWrap);
        var qState = getLessonActivityState(lessonNumQ);
        var answers = qState.answers || {};
        answers[qi] = pickedIdx;
        saveLessonActivityState(lessonNumQ, { answers: answers, done: true });
        var badgeQ = document.querySelector('.activity[data-lesson="' + lessonNumQ + '"] .activity-done-badge');
        if (badgeQ) badgeQ.hidden = false;
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
      persistSeqOrder(seqMove.closest('.activity'));
      return;
    }

    // --- Word bank: click (or drag, handled in pointer events below) a
    // chip to pick it up, then click a blank to drop it there. Clicking a
    // filled blank pops its word back to the bank. ---
    var wbChip = e.target.closest('.wb-chip');
    if (wbChip && !wbChip.disabled) {
      var wbActivityEl = wbChip.closest('.activity');
      var wbLessonNum = wbActivityEl.getAttribute('data-lesson');
      var chipIdx = Number(wbChip.getAttribute('data-chip'));
      if (wbSelectedChip && wbSelectedChip.chipIdx === chipIdx && wbSelectedChip.lessonNum === wbLessonNum) {
        clearWbSelection();
      } else {
        clearWbSelection();
        wbChip.classList.add('is-selected');
        wbSelectedChip = { lessonNum: wbLessonNum, chipIdx: chipIdx, el: wbChip };
      }
      return;
    }

    var wbBlank = e.target.closest('.wb-blank');
    if (wbBlank) {
      var wbActivityEl2 = wbBlank.closest('.activity');
      var wbLessonNum2 = wbActivityEl2.getAttribute('data-lesson');
      var blankIdx = Number(wbBlank.getAttribute('data-blank'));
      var wbState = getLessonActivityState(wbLessonNum2);
      var filled = wbState.filled || {};
      var wbCfg = findActivityConfig(wbLessonNum2);
      if (!wbCfg) return;
      if (filled[blankIdx] !== undefined) {
        delete filled[blankIdx];
        saveLessonActivityState(wbLessonNum2, { filled: filled, checked: false });
        clearWbSelection();
        wbActivityEl2.outerHTML = activityHtml(wbLessonNum2, wbCfg);
      } else if (wbSelectedChip && wbSelectedChip.lessonNum === wbLessonNum2) {
        filled[blankIdx] = wbSelectedChip.chipIdx;
        saveLessonActivityState(wbLessonNum2, { filled: filled, checked: false, done: true });
        clearWbSelection();
        wbActivityEl2.outerHTML = activityHtml(wbLessonNum2, wbCfg);
      }
      return;
    }

    // --- Spin the wheel, and answer whichever question it lands on ---
    var wheelSpinBtn = e.target.closest('.activity-wheel-spin-btn');
    if (wheelSpinBtn) {
      spinWheel(wheelSpinBtn.closest('.activity'));
      return;
    }

    var wheelOpt = e.target.closest('[data-wheel-opt]');
    if (wheelOpt && !wheelOpt.disabled) {
      var wqWrap = wheelOpt.closest('.wheel-question');
      var wheelActivityEl = wheelOpt.closest('.activity');
      var wheelLessonNum = wheelActivityEl.getAttribute('data-lesson');
      var segIdx = Number(wqWrap.getAttribute('data-seg'));
      var wheelQIdx = Number(wqWrap.getAttribute('data-q'));
      var wheelCfg = findActivityConfig(wheelLessonNum);
      if (!wheelCfg) return;
      var segCfg = wheelCfg.segments[segIdx];
      var questionCfg = segCfg.questions[wheelQIdx];
      var wheelState = getLessonActivityState(wheelLessonNum);
      var answeredMap = wheelState.answered || {};
      if (answeredMap[segIdx] !== undefined) return;
      var wheelPickedIdx = Number(wheelOpt.getAttribute('data-wheel-opt'));
      var wasAllMastered = wheelMasteredCount(wheelCfg.segments, answeredMap) >= wheelCfg.segments.length;
      answeredMap[segIdx] = { qIdx: wheelQIdx, picked: wheelPickedIdx };
      saveLessonActivityState(wheelLessonNum, { answered: answeredMap, done: true });
      if (wheelPickedIdx === questionCfg.correct) {
        var nowAllMastered = wheelMasteredCount(wheelCfg.segments, answeredMap) >= wheelCfg.segments.length;
        playFeedback(wheelOpt, 'anim-pop');
        if (nowAllMastered && !wasAllMastered) {
          launchConfetti(wheelActivityEl, { count: 90, spread: 12 });
        } else {
          launchConfetti(wheelOpt, { count: 30 });
        }
      } else {
        playFeedback(wheelOpt, 'anim-shake');
      }
      setTimeout(function () {
        var el = document.querySelector('.activity[data-lesson="' + wheelLessonNum + '"]');
        var freshCfg = findActivityConfig(wheelLessonNum);
        if (el && freshCfg) el.outerHTML = activityHtml(wheelLessonNum, freshCfg);
      }, 420);
      return;
    }

    var checkBtn = e.target.closest('[data-check]');
    if (checkBtn) {
      var kind = checkBtn.getAttribute('data-check');
      var activityEl = checkBtn.closest('.activity');
      var lessonNumC = activityEl ? activityEl.getAttribute('data-lesson') : null;
      if (kind === 'sequence') checkSequence(checkBtn, lessonNumC);
      else if (kind === 'match') checkMatch(checkBtn, lessonNumC);
      else if (kind === 'rubric') checkRubric(checkBtn, lessonNumC);
      else if (kind === 'allocator-budget') checkAllocatorBudget(checkBtn, lessonNumC);
      else if (kind === 'allocator-calc') checkAllocatorCalc(checkBtn, lessonNumC);
      else if (kind === 'checklist') checkChecklist(checkBtn, lessonNumC);
      else if (kind === 'wordbank') checkWordbank(checkBtn, lessonNumC);
      else if (kind === 'builder') checkBuilder(checkBtn, lessonNumC);
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
      var rows = wrap.querySelectorAll('.activity-allocator-row');
      var values = {};
      rows.forEach(function (row, ri) {
        var v = row.querySelector('.activity-allocator-input').value;
        values[ri] = v;
        sum += Number(v) || 0;
      });
      if (sumEl) sumEl.textContent = String(sum);
      wrap.classList.toggle('is-over-budget', sum > total);
      var lessonNumA = wrap.closest('.activity').getAttribute('data-lesson');
      saveLessonActivityState(lessonNumA, { values: values });
      return;
    }

    var rubricInput = e.target.closest('.activity-rubric-input');
    if (rubricInput) {
      var rWrap = rubricInput.closest('.activity');
      var lessonNumR = rWrap.getAttribute('data-lesson');
      var subjects = rWrap.querySelectorAll('.activity-rubric-subject');
      var scores = {};
      subjects.forEach(function (subj, si) {
        var subjScores = {};
        subj.querySelectorAll('.activity-rubric-input').forEach(function (inp, ci) {
          subjScores[ci] = inp.value;
        });
        scores[si] = subjScores;
      });
      saveLessonActivityState(lessonNumR, { scores: scores });
      return;
    }

    var builderInput = e.target.closest('.activity-builder-input');
    if (builderInput) {
      var bWrap = builderInput.closest('.activity');
      var lessonNumB = bWrap.getAttribute('data-lesson');
      var fields = bWrap.querySelectorAll('.activity-builder-input');
      var values2 = {};
      fields.forEach(function (ta, fi) {
        values2[fi] = ta.value;
      });
      saveLessonActivityState(lessonNumB, { values: values2 });
      return;
    }

    var calcInput = e.target.closest('.activity-calc-input');
    if (calcInput) {
      var cWrap = calcInput.closest('.activity');
      var lessonNumCalc = cWrap.getAttribute('data-lesson');
      var calcInputs = {};
      cWrap.querySelectorAll('.activity-calc-input').forEach(function (el) {
        calcInputs[el.getAttribute('data-key')] = el.value;
      });
      saveLessonActivityState(lessonNumCalc, { inputs: calcInputs });
      return;
    }
  });

  document.addEventListener('change', function (e) {
    var matchSelect = e.target.closest('.activity-match-select');
    if (matchSelect) {
      var mWrap = matchSelect.closest('.activity');
      var lessonNumM = mWrap.getAttribute('data-lesson');
      var rows = mWrap.querySelectorAll('.activity-match-row');
      var selections = {};
      rows.forEach(function (row, ri) {
        selections[ri] = row.querySelector('.activity-match-select').value;
      });
      saveLessonActivityState(lessonNumM, { selections: selections });
      return;
    }

    var checklistInput = e.target.closest('.activity-checklist-input');
    if (checklistInput) {
      var clWrap = checklistInput.closest('.activity');
      var lessonNumCl = clWrap.getAttribute('data-lesson');
      var items = clWrap.querySelectorAll('.activity-checklist-item');
      var checkedMap = {};
      items.forEach(function (item, ii) {
        checkedMap[ii] = item.querySelector('.activity-checklist-input').checked;
      });
      saveLessonActivityState(lessonNumCl, { checked: checkedMap });
      return;
    }
  });

  function persistSeqOrder(activityEl) {
    var lessonNum = activityEl.getAttribute('data-lesson');
    var order = Array.prototype.map.call(
      activityEl.querySelectorAll('.activity-seq-item'),
      function (item) { return Number(item.getAttribute('data-correct-idx')); }
    );
    saveLessonActivityState(lessonNum, { order: order });
  }

  // Real drag-to-reorder for sequence cards, on top of the up/down buttons
  // (which stay for keyboard/accessibility). Pointer Events cover mouse and
  // touch in one code path: classic "sortable list" swap-on-crossing-the-
  // midpoint, not HTML5 native drag (which touch devices don't support).
  var seqDrag = null; // { item, list, startY, startTop, moved }
  var wbDrag = null; // { chip, activityEl, lessonNum, chipIdx, startX, startY, moved }
  var wbSelectedChip = null; // { lessonNum, chipIdx, el }: click-to-pick-up, click-to-place

  function clearWbSelection() {
    if (wbSelectedChip && wbSelectedChip.el) wbSelectedChip.el.classList.remove('is-selected');
    wbSelectedChip = null;
  }

  function placeChipInBlank(lessonNum, blankIdx, chipIdx) {
    var state = getLessonActivityState(lessonNum);
    var filled = state.filled || {};
    filled[blankIdx] = chipIdx;
    saveLessonActivityState(lessonNum, { filled: filled, checked: false, done: true });
    var cfg = findActivityConfig(lessonNum);
    var el = document.querySelector('.activity[data-lesson="' + lessonNum + '"]');
    if (cfg && el) el.outerHTML = activityHtml(lessonNum, cfg);
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;

    var chip = e.target.closest('.wb-chip');
    if (chip && !chip.disabled) {
      var wbActivityEl = chip.closest('.activity');
      wbDrag = {
        chip: chip,
        activityEl: wbActivityEl,
        lessonNum: wbActivityEl.getAttribute('data-lesson'),
        chipIdx: Number(chip.getAttribute('data-chip')),
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      try {
        chip.setPointerCapture(e.pointerId);
      } catch (err) {}
      return;
    }

    var item = e.target.closest('.activity-seq-item');
    if (!item || e.target.closest('.activity-seq-move')) return;
    var list = item.closest('.activity-seq-list');
    if (!list) return;
    seqDrag = { item: item, list: list, startY: e.clientY, startTop: item.offsetTop, moved: false };
    try {
      item.setPointerCapture(e.pointerId);
    } catch (err) {}
  });

  // Real dropping is imprecise (fingers, fast mice), so the target isn't a
  // pixel-exact hit test: it's whichever blank the pointer is within a
  // generous radius of, which also lets the drop zone light up as you drag.
  function findNearestBlank(activityEl, x, y) {
    var THRESHOLD = 30;
    var blanks = activityEl.querySelectorAll('.wb-blank');
    var best = null;
    var bestDist = Infinity;
    blanks.forEach(function (b) {
      var r = b.getBoundingClientRect();
      var withinX = x >= r.left - THRESHOLD && x <= r.right + THRESHOLD;
      var withinY = y >= r.top - THRESHOLD && y <= r.bottom + THRESHOLD;
      if (!withinX || !withinY) return;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dist = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    });
    return best;
  }

  document.addEventListener('pointermove', function (e) {
    if (wbDrag) {
      var dx = e.clientX - wbDrag.startX;
      var dy2 = e.clientY - wbDrag.startY;
      if (!wbDrag.moved && Math.abs(dx) < 4 && Math.abs(dy2) < 4) return;
      wbDrag.moved = true;
      wbDrag.chip.classList.add('is-dragging');
      wbDrag.chip.style.transform = 'translate(' + dx + 'px, ' + dy2 + 'px)';
      var hoverBlank = findNearestBlank(wbDrag.activityEl, e.clientX, e.clientY);
      wbDrag.activityEl.querySelectorAll('.wb-blank.is-drag-over').forEach(function (b) {
        if (b !== hoverBlank) b.classList.remove('is-drag-over');
      });
      if (hoverBlank) hoverBlank.classList.add('is-drag-over');
      return;
    }
    if (!seqDrag) return;
    var dy = e.clientY - seqDrag.startY;
    if (!seqDrag.moved && Math.abs(dy) < 4) return;
    seqDrag.moved = true;
    var item = seqDrag.item;
    item.classList.add('is-dragging');
    item.style.transform = 'translateY(' + dy + 'px)';

    var sibling = dy > 0 ? item.nextElementSibling : item.previousElementSibling;
    if (sibling) {
      var siblingMid = sibling.offsetTop + sibling.offsetHeight / 2;
      var dragMid = item.offsetTop + dy + item.offsetHeight / 2;
      var crossed = dy > 0 ? dragMid > siblingMid : dragMid < siblingMid;
      if (crossed) {
        if (dy > 0) seqDrag.list.insertBefore(sibling, item);
        else seqDrag.list.insertBefore(item, sibling);
        seqDrag.startY = e.clientY;
        item.style.transform = '';
      }
    }
  });

  function endSeqDrag(e) {
    if (wbDrag) {
      wbDrag.chip.classList.remove('is-dragging');
      wbDrag.chip.style.transform = '';
      wbDrag.activityEl.querySelectorAll('.wb-blank.is-drag-over').forEach(function (b) {
        b.classList.remove('is-drag-over');
      });
      if (wbDrag.moved) {
        var blank = findNearestBlank(wbDrag.activityEl, e.clientX, e.clientY);
        if (blank) {
          var blankIdx = Number(blank.getAttribute('data-blank'));
          var curState = getLessonActivityState(wbDrag.lessonNum);
          var curFilled = curState.filled || {};
          if (curFilled[blankIdx] === undefined) {
            placeChipInBlank(wbDrag.lessonNum, blankIdx, wbDrag.chipIdx);
          }
        }
        // A real drag just happened; drop any pending tap-to-select state
        // so the next click doesn't act on a stale selection.
        clearWbSelection();
      }
      wbDrag = null;
      return;
    }
    if (!seqDrag) return;
    seqDrag.item.classList.remove('is-dragging');
    seqDrag.item.style.transform = '';
    if (seqDrag.moved) {
      var activityEl = seqDrag.list.closest('.activity');
      if (activityEl) persistSeqOrder(activityEl);
    }
    seqDrag = null;
  }
  document.addEventListener('pointerup', endSeqDrag);
  document.addEventListener('pointercancel', endSeqDrag);

  function checkSequence(btn, lessonNum) {
    var wrap = btn.closest('.activity');
    var list = wrap.querySelector('.activity-seq-list');
    var items = Array.prototype.slice.call(list.querySelectorAll('.activity-seq-item'));
    var target = Number(list.getAttribute('data-target')) || items.length;
    var order = items.map(function (li) { return Number(li.getAttribute('data-correct-idx')); });
    var marks = sequenceMarks(order, target);
    var rightCount = 0;
    items.forEach(function (li, pos) {
      var mark = li.querySelector('.activity-seq-mark');
      li.classList.remove('is-correct', 'is-wrong');
      if (marks[pos] === null) {
        if (mark) mark.innerHTML = '';
        return;
      }
      if (marks[pos]) {
        rightCount++;
        li.classList.add('is-correct');
        if (mark) mark.innerHTML = '&#10003;';
        playFeedback(li, 'anim-pop');
      } else {
        li.classList.add('is-wrong');
        if (mark) mark.innerHTML = '&#10007;';
        playFeedback(li, 'anim-shake');
      }
    });
    var result = wrap.querySelector('.activity-result');
    if (result) {
      result.hidden = false;
      result.textContent = rightCount + ' of ' + target + ' in the right spot.';
    }
    if (rightCount === target) launchConfetti(wrap, { count: 50 });
    saveLessonActivityState(lessonNum, { order: order, checked: true });
  }

  function checkMatch(btn, lessonNum) {
    var wrap = btn.closest('.activity');
    var rows = wrap.querySelectorAll('.activity-match-row');
    var right = 0;
    var selections = {};
    rows.forEach(function (row, ri) {
      var select = row.querySelector('.activity-match-select');
      selections[ri] = select.value;
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
        playFeedback(row, 'anim-pop');
      } else {
        row.classList.add('is-wrong');
        if (mark) mark.innerHTML = '&#10007;';
        playFeedback(row, 'anim-shake');
      }
    });
    var result = wrap.querySelector('.activity-result');
    if (result) {
      result.hidden = false;
      result.textContent = right + ' of ' + rows.length + ' correct.';
    }
    if (rows.length && right === rows.length) launchConfetti(wrap, { count: 50 });
    saveLessonActivityState(lessonNum, { selections: selections, checked: true });
  }

  function checkRubric(btn, lessonNum) {
    var wrap = btn.closest('.activity');
    var scores = {};
    wrap.querySelectorAll('.activity-rubric-subject').forEach(function (subj, si) {
      var inputs = subj.querySelectorAll('.activity-rubric-input');
      var total = 0;
      var subjScores = {};
      inputs.forEach(function (inp, ci) {
        subjScores[ci] = inp.value;
        total += Number(inp.value) || 0;
      });
      scores[si] = subjScores;
      var reference = subj.getAttribute('data-reference');
      var note = subj.getAttribute('data-note');
      var maxTotal = inputs.length * 10;
      var compare = subj.querySelector('.activity-rubric-compare');
      if (compare) {
        compare.hidden = false;
        compare.textContent =
          'Your score: ' + total + ' out of ' + maxTotal + '.  Ours: ' + reference +
          ' out of ' + maxTotal + '. ' + note;
      }
    });
    saveLessonActivityState(lessonNum, { scores: scores, compared: true });
  }

  function checkAllocatorBudget(btn, lessonNum) {
    var wrap = btn.closest('.activity-allocator');
    var rows = wrap.querySelectorAll('.activity-allocator-row');
    var lines = [];
    var values = {};
    rows.forEach(function (row, ri) {
      values[ri] = row.querySelector('.activity-allocator-input').value;
      lines.push(row.querySelector('.activity-allocator-label').textContent + ': ' + row.getAttribute('data-suggested'));
    });
    var result = wrap.querySelector('.activity-result');
    if (result) {
      result.hidden = false;
      result.textContent = 'A model allocation: ' + lines.join(', ') + '.';
    }
    saveLessonActivityState(lessonNum, { values: values, revealed: true });
  }

  function checkAllocatorCalc(btn, lessonNum) {
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
    saveLessonActivityState(lessonNum, { inputs: inputs, calculated: true });
  }

  function checkChecklist(btn, lessonNum) {
    var wrap = btn.closest('.activity-checklist');
    var graded = wrap.getAttribute('data-graded') === 'true';
    var items = wrap.querySelectorAll('.activity-checklist-item');
    var result = wrap.querySelector('.activity-result');
    var checkedMap = {};
    items.forEach(function (item, ii) {
      checkedMap[ii] = item.querySelector('.activity-checklist-input').checked;
      item.classList.remove('is-correct', 'is-wrong');
      if (graded) {
        var isFlag = item.getAttribute('data-flag') === 'true';
        var itemRight = checkedMap[ii] === isFlag;
        item.classList.add(itemRight ? 'is-correct' : 'is-wrong');
        playFeedback(item, itemRight ? 'anim-pop' : 'anim-shake');
      }
    });
    var activityLike = {
      graded: graded,
      minRequired: Number(wrap.getAttribute('data-min-required')) || 0,
      requireTagDiversity: Number(wrap.getAttribute('data-require-diversity')) || 0,
      items: Array.prototype.map.call(items, function (item) {
        return { isFlag: item.getAttribute('data-flag') === 'true', tag: item.getAttribute('data-tag') };
      }),
    };
    if (result) {
      result.hidden = false;
      result.textContent = checklistResultText(activityLike, checkedMap);
    }
    if (checklistSucceeded(activityLike, checkedMap)) launchConfetti(wrap, { count: 44 });
    saveLessonActivityState(lessonNum, { checked: checkedMap, submitted: true });
  }

  function checkBuilder(btn, lessonNum) {
    var wrap = btn.closest('.activity-builder');
    var values = {};
    wrap.querySelectorAll('.activity-builder-input').forEach(function (ta, fi) {
      values[fi] = ta.value;
    });
    wrap.querySelectorAll('.activity-builder-model').forEach(function (p) {
      p.hidden = false;
    });
    saveLessonActivityState(lessonNum, { values: values, revealed: true });
  }

  function checkWordbank(btn, lessonNum) {
    var wrap = btn.closest('.activity');
    var cfg = findActivityConfig(lessonNum);
    if (!cfg) return;
    var state = getLessonActivityState(lessonNum);
    var filled = state.filled || {};
    var bankWords = (cfg.blanks || []).concat(cfg.distractors || []);
    var bankOrder = state.bankOrder || [];
    var total = (cfg.blanks || []).length;
    var right = 0;
    Object.keys(filled).forEach(function (bi) {
      var word = bankWords[bankOrder[filled[bi]]];
      if (word === cfg.blanks[Number(bi)]) right++;
    });
    saveLessonActivityState(lessonNum, { checked: true, done: true });
    if (right === total) launchConfetti(wrap, { count: 46 });
    wrap.outerHTML = activityHtml(lessonNum, cfg);
  }

  // Spins to a random segment, landing via an accumulated rotation so each
  // spin continues smoothly from wherever the dial last stopped.
  function spinWheel(activityEl) {
    var dial = activityEl.querySelector('.wheel-dial');
    if (!dial || dial.classList.contains('is-spinning')) return;
    var lessonNum = activityEl.getAttribute('data-lesson');
    var cfg = findActivityConfig(lessonNum);
    if (!cfg || !cfg.segments || !cfg.segments.length) return;
    var n = cfg.segments.length;
    var segAngle = 360 / n;
    var priorState = getLessonActivityState(lessonNum);
    var idx = pickWheelIndex(cfg.segments, priorState.answered);
    var current = Number(dial.getAttribute('data-rotation')) || 0;
    var centerAngle = idx * segAngle + segAngle / 2;
    var currentMod = ((current % 360) + 360) % 360;
    var deltaToTarget = ((360 - centerAngle) - currentMod + 360) % 360;
    var extraSpins = 5 * 360 + Math.floor(Math.random() * 3) * 360;
    var target = current + extraSpins + deltaToTarget;

    dial.classList.add('is-spinning');
    dial.style.transition = 'transform 3.2s cubic-bezier(0.17, 0.67, 0.17, 1)';
    dial.style.transform = 'rotate(' + target + 'deg)';
    dial.setAttribute('data-rotation', target);
    var spinBtn = activityEl.querySelector('.activity-wheel-spin-btn');
    if (spinBtn) {
      spinBtn.disabled = true;
      spinBtn.textContent = 'Spinning…';
    }

    setTimeout(function () {
      // A topic that was answered wrong before gets a genuinely fresh shot
      // on this new landing (a newly-drawn question from its pool) rather
      // than staying locked on the old miss; one already answered correctly
      // stays locked in as mastered.
      var priorState = getLessonActivityState(lessonNum);
      var priorAnswered = priorState.answered || {};
      var topic = cfg.segments[idx];
      var wasMastered = wheelTopicMastered(topic, priorAnswered[idx]);
      if (!wasMastered && priorAnswered[idx] !== undefined) delete priorAnswered[idx];
      var newQIdx = Math.floor(Math.random() * topic.questions.length);
      saveLessonActivityState(lessonNum, {
        rotation: target,
        landedIndex: idx,
        landedQuestionIdx: newQIdx,
        done: true,
        answered: priorAnswered,
      });
      var freshCfg = findActivityConfig(lessonNum);
      var el = document.querySelector('.activity[data-lesson="' + lessonNum + '"]');
      if (el && freshCfg) el.outerHTML = activityHtml(lessonNum, freshCfg);
    }, 3300);
  }

  if (detailBack) {
    detailBack.addEventListener('click', function () {
      setView(lastListView);
    });
  }

  boot();
})();
