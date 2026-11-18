const root = document.getElementById('pulse-responsive');
const main = root.querySelector('main');
const nav = root.querySelector('nav');
const avatar = root.querySelector('.avatar');
const header = root.querySelector('header');
const sidebar = root.querySelector('.sidebar');
const brand = root.querySelector('.brand');
const accountTools = root.querySelector('.tools');
const desktopLayout = window.matchMedia('(min-width: 700px)');

function placeNavigation() {
  const useSidebar = desktopLayout.matches && page !== 'login';
  const destination = useSidebar ? sidebar : header;
  if (brand.parentElement !== destination) {
    destination.prepend(brand);
    destination.append(accountTools);
  }
  header.hidden = desktopLayout.matches || page === 'login';
}
desktopLayout.addEventListener('change', placeNavigation);
const iconMarkup = name => `<svg class="line-icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const sections = [
  ['today','Сегодня','pin'],['schedule','Расписание','calendar'],
  ['grades','Успеваемость','grades'],['requests','Заявки','document'],['map','Карта','map']
];
const sectionCounters = {campus:'newsUnreadCount', news:'unreadCount',
  requests:'requestUnreadCount'};
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const intro = (label, title, subtitle) => `<div class="intro">${label ? `<p class="kicker">${label}</p>` : ''}<h1>${escapeText(title)}</h1>${subtitle ? `<p class="intro-subtitle">${subtitle}</p>` : ''}</div>`;
const panel = (title, detail) => `<div class="panel"><b>${escapeText(title)}</b><p class="sub">${escapeText(detail)}</p></div>`;
let page = 'login';
let studentProfile;
let sectionData;
let pending = false;
let theme = localStorage.getItem('pulse-theme') === 'dark' ? 'dark' : 'light';
let mode = 'day';
let day;
let weekOffset = 0;
let comparisonTargets = [];
let comparisonOptions = [];
let comparisonTimer;
let mapFloor = 1;
let mapBuilding = 'main';
let mapRoom;
let requestForm = false;
let selectedSemester;
const dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const lessonTypes = {lecture: 'Лекция', practice: 'Практика', lab: 'Лабораторная', credit: 'Зачёт', exam: 'Экзамен'};
const shortDate = new Intl.DateTimeFormat('ru-RU', {day:'numeric', month:'long'});
const fullDate = new Intl.DateTimeFormat('ru-RU', {weekday:'long', day:'numeric', month:'long'});
const monthDate = new Intl.DateTimeFormat('ru-RU', {month:'long', year:'numeric'});
let calendarMonth;
const pagePaths = {login:'/login', today:'/today', schedule:'/schedule', compare:'/schedule/compare', grades:'/grades',
  requests:'/requests', profile:'/profile', news:'/notifications', campus:'/news', map:'/map', support:'/support'};
const pageFromLocation = () => Object.keys(pagePaths).find(key => pagePaths[key] === location.pathname) ?? 'today';
let signInTarget = pageFromLocation() === 'login' ? 'today' : pageFromLocation();
const dateFromISO = iso => new Date(iso + 'T00:00:00');
const dateISO = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');

function weekDates(offset, now = new Date()) {
  const weekday = (now.getDay() + 6) % 7;
  return Array.from({length:7}, (_, index) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + offset * 7 + index));
}

function jumpToDate(iso) {
  const date = dateFromISO(iso);
  day = (date.getDay() + 6) % 7;
  const monday = weekDates(0)[0];
  const currentWeek = Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate());
  weekOffset = (Date.parse(iso) - day * 86400000 - currentWeek) / 604800000;
  mode = 'week';
}

let openRequestId;
function restoreSectionState(target) {
  const query = new URLSearchParams(location.search);
  if (target === 'schedule' || target === 'compare') {
    mode = 'day';
    day = undefined;
    weekOffset = 0;
    const iso = query.get('date');
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && dateISO(dateFromISO(iso)) === iso) jumpToDate(iso);
    if (target === 'compare') comparisonTargets = history.state?.comparisonTargets ?? [];
  } else if (target === 'grades') {
    selectedSemester = Number(query.get('semester')) || undefined;
  } else if (target === 'map') {
    mapBuilding = query.get('building') ?? 'main';
    mapFloor = Number(query.get('floor')) || 1;
    mapRoom = query.get('room');
  } else if (target === 'requests') {
    openRequestId = Number(query.get('request')) || undefined;
  }
}

function saveSectionState(method = 'replaceState') {
  const query = new URLSearchParams();
  if ((page === 'schedule' || page === 'compare') && mode === 'week') {
    query.set('date', dateISO(weekDates(weekOffset)[day ?? (new Date().getDay() + 6) % 7]));
  } else if (page === 'grades' && selectedSemester) {
    query.set('semester', selectedSemester);
  } else if (page === 'map') {
    query.set('building', mapBuilding);
    query.set('floor', mapFloor);
    if (mapRoom) query.set('room', mapRoom);
  } else if (page === 'requests' && openRequestId) {
    query.set('request', openRequestId);
  }
  const url = pagePaths[page] + (query.size ? '?' + query : '');
  if (method === 'pushState' && url === location.pathname + location.search) method = 'replaceState';
  history[method](page === 'compare' ? {comparisonTargets} : null, '', url);
}

function calendarGrid(selected) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const first = new Date(year, month, 1);
  const leading = (first.getDay() + 6) % 7;
  const count = Math.ceil((leading + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const today = dateISO(new Date());
  return `<div class="calendar-heading">
    <button type="button" data-calendar-month="-1" aria-label="Предыдущий месяц">‹</button>
    <b aria-live="polite">${monthDate.format(first).replace(/ г\.$/, '')}</b>
    <button type="button" data-calendar-month="1" aria-label="Следующий месяц">›</button>
  </div><div class="calendar-grid">
    ${dayNames.map(name => `<span>${name}</span>`).join('')}
    ${Array.from({length:count}, (_, index) => {
      const date = new Date(year, month, 1 - leading + index);
      const iso = dateISO(date);
      return `<button type="button" data-calendar-date="${iso}" aria-label="${fullDate.format(date)}" aria-pressed="${iso === selected}" ${iso === today ? 'aria-current="date"' : ''} class="${date.getMonth() === month ? '' : 'outside-month'}">${date.getDate()}</button>`;
    }).join('')}
  </div>`;
}

function todayLesson(lessons, now = new Date()) {
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  for (const [index, lesson] of lessons.entries()) {
    const [start, end] = lesson[0].split(/[-–—]/).map(toMinutes);
    if (Number.isFinite(end) && currentMinute >= end) continue;
    const label = currentMinute >= start && currentMinute < end ? 'Сейчас идёт'
      : index === 0 ? 'Первая пара' : 'Ближайшая пара';
    return {lesson, label};
  }
  return {};
}

function today() {
  const {lastRequest: last, lessons, deadline, date} = sectionData;
  const {lesson: first, label} = todayLesson(lessons);
  return `<div class="section-header today-header">${intro('', 'Привет, ' + studentProfile.nickname + '!')}
    <p class="today-date">${fullDate.format(dateFromISO(date))}</p></div>` +
    `<div class="today-grid"><section class="hero">${first ? `<div class="row"><p class="kicker">${label}</p>${first[3] ? '<span class="tag">Перенос</span>' : ''}</div>
    <h2>${escapeText(first[1])}</h2><p>${escapeText(first[0])} · ${lessonLocation(first[2])}</p>${first[3] ? `<small>Прежняя аудитория ${escapeText(first[3])}</small>` : ''}
    ` : `<h2>${lessons.length ? 'Пары закончились' : 'Сегодня занятий нет'}</h2>`}<button data-page="schedule">Открыть расписание →</button></section>
    <div class="today-details"><div class="headrow"><h2>Ближайшие дедлайны</h2></div>` +
    panel(deadline.title, deadline.detail) +
    `<div class="headrow"><h2>Последняя заявка</h2></div>` +
    (last ? `<div class="panel"><b>${escapeText(last.type)}</b><p class="sub">${escapeText(last.status)}</p>
      ${last.status === 'Готова' ? `<button class="action" data-page="requests" data-open-request="${last.id}">Перейти к заявке</button>` : ''}</div>`
      : panel('Заявок пока нет', 'Создай первую заявку в разделе «Заявки».')) + '</div></div>';
}
function schedule() {
  const {group, days, sessionTitle} = sectionData;
  const comparing = page === 'compare';
  const selectedDay = mode === 'day' ? 0 : day ?? (new Date().getDay() + 6) % 7;
  const dates = days.map(item => dateFromISO(item.date));
  const items = days[selectedDay].lessons;
  const weekEnd = dates.at(-1);
  const week = `${shortDate.format(dates[0])} – ${shortDate.format(weekEnd)} ${weekEnd.getFullYear()}`;
  const controls = `
    <div class="schedule-controls">
      <button type="button" class="calendar-trigger" popovertarget="schedule-calendar" aria-label="Выбрать дату">${iconMarkup('calendar')}</button>
      <div id="schedule-calendar" class="schedule-calendar" popover aria-label="Календарь" data-selected-date="${days[selectedDay].date}">${calendarForDate(days[selectedDay].date)}</div>
      <button data-mode="day" aria-pressed="${mode === 'day'}">Сегодня</button>
      <button data-mode="week" aria-pressed="${mode === 'week'}">Неделя</button>
      <button class="action" data-page="${comparing ? 'schedule' : 'compare'}" data-keep-schedule>${comparing ? 'К расписанию' : 'Перейти к сравнению'}</button>
    </div>`;
  return `<div class="section-header schedule-header">
    <div class="schedule-heading">${intro('', comparing ? 'Сравнение расписаний' : 'Расписание')}
      ${comparing ? '' : `<span class="tag">Моя группа · ${escapeText(group)}</span>`}
      ${comparing && mode === 'day' ? `<h2 class="mobile-comparison-date">${fullDate.format(dates[selectedDay])}</h2>` : ''}
      ${mode === 'week' ? `<div class="week-controls row"><button data-week="-1" aria-label="Предыдущая неделя">‹</button><b>${week}</b><button data-week="1" aria-label="Следующая неделя">›</button></div>` : ''}
    </div>${controls}
  </div>` +
    (sessionTitle ? `<span class="tag">${escapeText(sessionTitle)}</span>` : '') +
    (mode === 'week' ? `<div class="days">${dayNames.map((name,index) => {
      const lessons = days[index].lessons;
      return `<button data-day="${index}" aria-pressed="${selectedDay === index}" aria-label="${fullDate.format(dates[index])}: занятий ${lessons.length}"><span>${name} ${dates[index].getDate()}</span><span class="day-dots" aria-hidden="true">${lessons.map(lesson => lessonDot(lesson[4])).join('')}</span></button>`;
    }).join('')}</div>` : '') +
    (mode === 'day' ? `<h2${comparing ? ' class="desktop-comparison-date"' : ''}>${fullDate.format(dates[selectedDay])}</h2>` : '') +
    (comparing ? `<div data-comparison-panel>${comparisonPanel(sectionData.comparison)}</div>` : `<div class="schedule-lessons">` + (items.length ? items.map(([time,title,detail,previousRoom,type], index) => `${scheduleGap(items[index - 1], time)}<div class="panel">
      <div class="row"><p class="kicker">${escapeText(time)}</p>${previousRoom ? '<span class="tag">Перенос</span>' : ''}</div>
      <b>${escapeText(title)}</b><p class="sub lesson-kind">${lessonDot(type)}${lessonTypes[type]}</p>
      <p class="sub">${lessonLocation(detail)}</p>${previousRoom ? `<p class="sub">Прежняя аудитория ${escapeText(previousRoom)}</p>` : ''}
    </div>`).join('') + `<p class="schedule-end">Последняя пара заканчивается в ${escapeText(items.at(-1)[0].split('–')[1])}</p>`
      : panel('Занятий нет','На этот день ничего не запланировано.')) + '</div>');
}
function comparisonPanel({schedules,maxTargets}) {
  const slots = [...new Set(schedules.flatMap(item => item.lessons.map(lesson => lesson[0])))].sort();
  return `<div class="panel comparison-search">
    ${comparisonTargets.length < maxTargets ? `<label>Найти группу или преподавателя
      <input type="search" data-comparison-search maxlength="80" autocomplete="off" placeholder="Начни вводить название или фамилию"></label>
      <div class="comparison-options" data-comparison-options aria-live="polite"></div>` : ''}
    ${comparisonTargets.map(({id,name}) => `<button class="comparison-chip" data-remove-target="${id}" aria-label="Убрать ${escapeText(name)}">${escapeText(name)} ×</button>`).join('')}
    ${comparisonTargets.length === 0 ? `<p class="sub">Добавь до ${maxTargets} групп или преподавателей, чтобы сравнить пары по времени.</p>` : ''}
  </div>
  <div class="comparison-table" role="region" aria-label="Таблица сравнения расписаний" tabindex="0"><table>
    <thead><tr><th scope="col">Время</th>${schedules.map(item => `<th scope="col">${escapeText(item.name)}${item.kind === 'own' ? ' · моя группа' : ''}</th>`).join('')}</tr></thead>
    <tbody>${slots.map(slot => `<tr><th scope="row">${escapeText(slot)}</th>${schedules.map(item => {
      const lessons = item.lessons.filter(lesson => lesson[0] === slot);
      return `<td>${lessons.length ? lessons.map(([,title,detail,,type,group]) => `<div><b>${escapeText(title)}</b>
        <p class="sub lesson-kind">${lessonDot(type)}${lessonTypes[type]}</p>
        <p class="sub">${lessonLocation(detail)}${group ? ' · ' + escapeText(group) : ''}</p></div>`).join('') : '—'}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table>${slots.length ? '' : '<p>На этот день занятий нет.</p>'}</div>`;
}

async function fetchComparison(data, targets) {
  const selectedDay = mode === 'day' ? 0 : day ?? (new Date().getDay() + 6) % 7;
  const query = new URLSearchParams({date:data.days[selectedDay].date});
  for (const option of targets) query.append('target', option.id);
  return api(`/api/schedule/compare?${query}`);
}

async function updateComparison(targets) {
  pending = true;
  try {
    const comparison = await fetchComparison(sectionData, targets);
    comparisonTargets = targets;
    sectionData.comparison = comparison;
    main.querySelector('[data-comparison-panel]').innerHTML = comparisonPanel(comparison);
    saveSectionState();
  } catch (error) {
    if (error.status === 401) showLogin();
    showError(error);
  } finally {
    pending = false;
  }
}
function toMinutes(clock) {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}
function scheduleGap(previous, time) {
  if (!previous) return '';
  const from = previous[0].split('–')[1];
  const to = time.split('–')[0];
  const gap = toMinutes(to) - toMinutes(from);
  if (gap < 30) return '';
  const duration = [Math.floor(gap / 60) ? `${Math.floor(gap / 60)} ч` : '', gap % 60 ? `${gap % 60} мин` : ''].filter(Boolean).join(' ');
  return `<p class="schedule-gap">Окно ${duration} · ${from}–${to}</p>`;
}
function calendarForDate(date) {
  calendarMonth = dateFromISO(date);
  return calendarGrid(date);
}
const lessonDot = type => `<i class="lesson-dot ${type}" aria-hidden="true"></i>`;
function grades() {
  const {semesters, currentSemester, semester} = sectionData;
  const options = semesters.map(number => {
    const status = number === currentSemester ? ' · актуальный' : '';
    return `<button data-pick-semester="${number}" aria-pressed="${number === semester.number}">${number} семестр${status}</button>`;
  }).join('');
  return `<div class="section-header">${intro('','Успеваемость')}
    <div class="semester-picker"><button class="semester-trigger" popovertarget="semester-options" aria-label="Выбрать семестр, выбран ${semester.number}">${semester.number} семестр${semester.number === currentSemester ? ' · актуальный' : ''}${iconMarkup('chevron-down')}</button>
    <div id="semester-options" popover aria-label="Семестры">${options}</div></div></div>
    ${semester.courses.some(course => course.points) ? `<ul class="grade-breakdown panel" aria-label="Виды баллов">${gradeCategories.map(([, label, color]) =>
      `<li>${lessonDot(color)}${label}</li>`).join('')}</ul>` : ''}
    <div data-semester-results aria-live="polite">${semesterResults(semester)}</div>`;
}

function gradeForecast(score, assessment) {
  if (assessment === 'Зачёт') return score >= 40 ? 'Зачёт' : 'Незачёт';
  if (assessment === 'Экзамен') {
    if (score >= 80) return '5';
    if (score >= 60) return '4';
    if (score >= 40) return '3';
    return '2';
  }
  return '';
}
const gradeCategories = [
    ['attendance', 'Посещение', 'lecture'],
    ['practice', 'Практики', 'practice'],
    ['achievements', 'Индивидуальные достижения', 'lab'],
    ['assessment', 'Экзамен или зачёт', 'exam'],
];
function gradeBreakdown(points, total, assessment) {
  let offset = 0;
  const segments = gradeCategories.map(([key, label, color]) => {
    const width = points[key];
    const x = offset;
    offset += width;
    const ending = width % 100 >= 11 && width % 100 <= 14 ? 'баллов'
      : width % 10 === 1 ? 'балл' : width % 10 >= 2 && width % 10 <= 4 ? 'балла' : 'баллов';
    const hint = `${width} ${ending}`;
    return width ? `<rect class="${color}" x="${x}" width="${width}" height="10" tabindex="0" aria-label="${key === 'assessment' ? assessment : label}: ${hint}" data-grade-hint="${hint}"/>` : '';
  }).join('');
  return `<div class="grade-meter"><svg class="grade-progress" viewBox="0 0 ${escapeText(total)} 10" preserveAspectRatio="none" aria-label="Баллы по категориям">${segments}</svg>
    <span class="grade-hint" hidden></span></div>`;
}
function semesterResults(semester) {
  return semester.courses.map(({title, score, total, assessment, result, points}) => `<div class="panel">
    <div class="row"><b>${escapeText(title)}</b>${score == null ? '' : `<span class="tag grade-score">${escapeText(score)} из ${escapeText(total)}</span>`}</div>
    ${points ? gradeBreakdown(points, total, assessment) : ''}
    ${semester.number === sectionData.currentSemester && score != null && gradeForecast(score, assessment)
      ? `<p class="sub assessment">${escapeText(assessment)} · Прогноз: <strong>${gradeForecast(score, assessment)}</strong></p>`
      : assessment ? `<p class="sub assessment">${escapeText(assessment)}${result ? ` · <strong>${escapeText(result)}</strong>` : ''}</p>` : ''}
  </div>`).join('');
}
for (const eventName of ['pointerover', 'focusin', 'click', 'pointerout', 'focusout']) {
  main.addEventListener(eventName, event => {
    const segment = event.target.closest('[data-grade-hint]');
    if (!segment) return;
    const meter = segment.closest('.grade-meter');
    const hint = meter.querySelector('.grade-hint');
    hint.textContent = segment.dataset.gradeHint;
    hint.hidden = eventName === 'pointerout' || eventName === 'focusout';
    if (!hint.hidden) {
      const bounds = meter.getBoundingClientRect();
      const part = segment.getBoundingClientRect();
      const half = hint.offsetWidth / 2;
      const center = part.left - bounds.left + part.width / 2;
      hint.style.left = `${Math.max(half, Math.min(center, bounds.width - half))}px`;
    }
  });
}
const educationCertificateType = 'Справка об обучении';
const transcriptType = 'Выписка из зачётки';
const requestGuides = {
  [educationCertificateType]: ['Подтверждает, что ты учишься в вузе. Подойдёт для работы или других организаций.'],
  'Справка об успеваемости': ['Содержит сведения о пройденных дисциплинах и результатах.', 'Данные берутся из учебной ведомости.', 'Обычно до 5 рабочих дней.'],
  [transcriptType]: ['В PDF войдут дисциплины и итоговые оценки за все завершённые курсы.'],
};
function requestGuide(type) {
  return requestGuides[type].map(line => `<p>${line}</p>`).join('');
}
function requestPage() {
  const {requests} = sectionData;
  const types = Object.keys(requestGuides);
  const initialType = types[0];
  return `<div class="section-header">${intro('','Заявки и справки')}
    <div class="request-actions">${sectionData.unreadCount ? '<button data-read-notifications>Отметить прочитанными</button>' : ''}
    ${requestForm ? '' : '<button class="action" data-new>＋ Создать заявку</button>'}</div></div>` +
    (requestForm ? `<form class="panel" data-form="request"><div class="semester-picker request-type-picker">
    <input type="hidden" name="type" value="${initialType}" hidden>
    <button type="button" class="semester-trigger" popovertarget="request-type-options" aria-label="Тип заявки: ${initialType}"><span>${initialType}</span>${iconMarkup('chevron-down')}</button>
    <div id="request-type-options" popover aria-label="Типы заявок">${types.map(type =>
      `<button type="button" data-request-type="${type}" aria-pressed="${type === initialType}">${type}</button>`).join('')}</div></div>
    <div class="request-guide" aria-live="polite">${requestGuide(initialType)}</div>
    <label class="request-purpose">Куда нужна справка?
      <textarea name="purpose" rows="2" maxlength="250" placeholder="Например, для отдела кадров по месту работы" required></textarea>
    </label>
    <p role="alert"></p><button class="action">Отправить заявку</button><button type="button" data-cancel>Отмена</button></form>` :
    '') +
    (requests.length ? requests.map(requestCard).join('') : panel('Заявок пока нет', 'Отправленные заявки появятся здесь.'));
}
const requestDate = new Intl.DateTimeFormat('ru-RU', {
  dateStyle:'medium', timeStyle:'short', timeZone:'Europe/Moscow',
});
function chatMessage({author, body, occurred_at}) {
  const text = body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const date = new Date(occurred_at * 1000);
  return `<li class="chat-message" data-author="${author}">
    <div class="row"><b>${author === 'office' ? 'Деканат · демо' : 'Ты'}</b><time class="sub" datetime="${date.toISOString()}">${requestDate.format(date)} МСК</time></div>
    <p>${text}</p>
  </li>`;
}
function revealRequest(id) {
  const card = document.getElementById(`request-${id}`);
  if (!card) return;
  openRequestId = Number(id);
  saveSectionState();
  card.open = true;
  card.querySelector('summary').focus();
  card.scrollIntoView({block:'nearest'});
}
const requestStages = ['Принята', 'Требуется уточнение', 'В работе', 'Готова'];
function requestCard({id, type, status, history, messages}) {
  const canDownload = status === 'Готова' && [educationCertificateType, transcriptType].includes(type);
  const currentStage = requestStages.indexOf(status);
  const recordedStages = new Map(history.map(event => [event.status, event]));
  return `<details id="request-${id}" class="panel request-card" ${id === openRequestId ? 'open' : ''}>
    <summary><div class="request-title"><p class="kicker">№ ${id}</p><b>${type}</b></div>
    <div class="request-status"><span class="tag">${status}</span></div>
    <span class="request-chevron">${iconMarkup('chevron-down')}</span></summary>
    <div class="request-details">
      <section class="request-history">
        <h3>История статусов</h3>
        <ol class="request-timeline">${requestStages.map((stage, index) => {
          const event = recordedStages.get(stage);
          const date = event?.occurred_at == null ? null : new Date(event.occurred_at * 1000);
          const timeId = `request-${id}-time-${index}`;
          const reached = index === currentStage || (index < currentStage && Boolean(event));
          const state = reached ? 'reached' : index < currentStage ? 'skipped' : 'pending';
          return `<li data-state="${state}" ${index === currentStage ? 'aria-current="step"' : ''}>
            <span class="request-step" ${reached ? `aria-describedby="${timeId}" tabindex="0"` : ''}>
              <span class="request-step-dot" aria-hidden="true"></span>
              <b>${stage}</b>
            </span>
            ${canDownload && stage === 'Готова' ? `<a class="certificate-link" href="/api/requests/${id}/certificate">Скачать PDF</a>` : ''}
            ${state === 'skipped' ? '<span class="request-step-skipped">Пропущено</span>' : ''}
            ${reached ? `<span class="request-step-time" id="${timeId}" role="tooltip">${date ? `<time datetime="${date.toISOString()}">${requestDate.format(date)} МСК</time>` : 'Дата не сохранена'}</span>` : ''}
          </li>`;
        }).join('')}</ol>
      </section>
      <section class="request-conversation">
        <h3>Переписка по заявке</h3>
        <div class="request-chat-scroll" role="log" aria-label="Сообщения по заявке" tabindex="0">
          ${messages.length ? '' : '<p class="sub chat-empty">Сообщений пока нет.</p>'}
          <ul class="request-chat">${messages.map(chatMessage).join('')}</ul>
        </div>
        <form data-form="request-message" data-request-id="${id}">
          <label>Сообщение<textarea name="message" rows="2" maxlength="1000" required></textarea></label>
          <p role="alert"></p>
          <button class="action">Отправить сообщение</button>
        </form>
      </section>
    </div>
  </details>`;
}
function feedSwitch() {
  const tabs = [['news', 'Уведомления'], ['campus', 'Новости']];
  return `<div class="schedule-switch" role="group" aria-label="Ленты">${tabs.map(([id, label]) => {
    const unread = studentProfile[sectionCounters[id]] ?? 0;
    return `<button data-page="${id}" aria-pressed="${page === id}">${label}${unread ? ` (${unread})` : ''}</button>`;
  }).join('')}</div>`;
}
function news() {
  const {deadline, unreadCount, sessions, transfer, transferDate, reminder, announcements = []} = sectionData;
  return `<div class="section-header">${intro('','Уведомления')}
    ${unreadCount ? '<button class="action" data-read-notifications>Отметить все прочитанными</button>' : ''}</div>` + feedSwitch() +
    announcements.map(({title, detail}) => `<article class="panel feed-card">
      <span class="tag">Объявление деканата</span>
      <h3 class="news-title">${escapeText(title)}</h3><p class="sub">${escapeText(detail)}</p>
    </article>`).join('') +
    (transfer ? `<article class="panel feed-card feed-transfer">
      <span class="tag">Перенос пары · ${shortDate.format(dateFromISO(transferDate))}</span>
      <h3 class="news-title">${escapeText(transfer[1])}</h3><p>${escapeText(transfer[2])}</p>
      <button data-page="schedule" data-transfer="${transferDate}">К занятию →</button>
    </article>` : '') +
    `<article class="panel feed-card"><span class="tag">Напоминание</span><h3 class="news-title">${escapeText(reminder[0])}</h3><p class="sub">${escapeText(reminder[1])}</p></article>` +
    sessions.map(({title, start, end}) => `<article class="panel feed-card ${title.startsWith('Зачёт') ? 'feed-credit' : 'feed-exam'}">
      <h3 class="news-title">${escapeText(title)}</h3>
      <p class="sub">С ${shortDate.format(dateFromISO(start))} по ${shortDate.format(dateFromISO(end))}</p>
      <button data-page="schedule" data-transfer="${start}">Перейти к расписанию сессии →</button>
    </article>`).join('') +
    `<article class="panel feed-card feed-deadline"><span class="tag">Дедлайн</span><h3 class="news-title">${escapeText(deadline.title)}</h3><p class="sub">${escapeText(deadline.detail)}</p></article>`;
}
function campusNews() {
  const {campusEvents, unreadCount} = sectionData;
  return `<div class="section-header">${intro('','Новости')}
    ${unreadCount ? '<button class="action" data-read-notifications>Отметить все прочитанными</button>' : ''}</div>` + feedSwitch() +
    campusEvents.map(([date, title, detail]) => `<article class="panel feed-card"><span class="tag">${escapeText(date)}</span><h3 class="news-title">${escapeText(title)}</h3><p class="sub">${escapeText(detail)}</p></article>`).join('');
}
let avatarVersion = 0;
function avatarContent(profile) {
  return profile?.hasAvatar ? `<img class="avatar-photo" src="/api/profile/avatar?v=${avatarVersion}" alt="">`
    : escapeText(profile?.initials);
}
function groupMemberCard(name) {
  const initials = name.split(' ').slice(1).join('').replaceAll('.', '');
  return `<li class="group-member">
    <span class="group-member-initials" aria-hidden="true">${escapeText(initials)}</span>
    <span class="group-member-name">${escapeText(name)}</span>
  </li>`;
}
function profile() {
  const profile = studentProfile;
  return intro('','Профиль') +
    `<div class="identity"><button class="initials avatar-upload" data-avatar-edit aria-label="Выбрать аватарку">${avatarContent(profile)}<span class="avatar-camera">${iconMarkup('camera')}</span></button>
    <input type="file" data-avatar-file accept="image/jpeg,image/png,image/webp" hidden>
    <div><b>${escapeText(profile.name)}</b>${profile.recordBook ? `<p class="sub">Зачётка № ${escapeText(profile.recordBook)}</p>` : ''}<p class="sub">${escapeText(profile.year)} курс · ${escapeText(profile.group)}</p></div></div>
    <div class="panel"><h2>Обучение</h2><dl><div><dt>Факультет</dt><dd>${escapeText(profile.faculty)}</dd></div><div><dt>Направление</dt><dd>${escapeText(profile.program)}</dd></div></dl></div>
    <details class="panel group-roster">
      <summary><strong>Список группы</strong><span class="sub">${escapeText(profile.group)}</span>${iconMarkup('chevron-down')}</summary>
      <ul class="group-members" role="list">${(profile.groupMembers ?? []).map(groupMemberCard).join('')}</ul>
    </details>
    <div class="panel menu">
      <button class="menu-row" data-theme-toggle><span class="glyph" aria-hidden="true">☾</span><span>Тема оформления</span><span class="menu-value">${theme === 'dark' ? 'Тёмная' : 'Светлая'}</span><span class="glyph" aria-hidden="true">›</span></button>
      <button class="menu-row" data-page="support">${iconMarkup('support')}<span>Техническая поддержка</span><span class="menu-value glyph" aria-hidden="true">›</span></button>
    </div>
    <div class="panel menu"><button class="menu-row" data-logout>${iconMarkup('logout')}Выйти</button></div>`;
}
function lessonLocation(detail) {
  const [roomLabel, teacher] = detail.split(' · ');
  const room = roomLabel.replace(/^Ауд\.\s*/, '');
  for (const [building, {floors}] of Object.entries(studentProfile?.campusMap ?? {})) {
    for (const [floor, rooms] of Object.entries(floors)) {
      if (!rooms.some(([name]) => name === room)) continue;
      const query = new URLSearchParams({building, floor, room}).toString().replaceAll('&', '&amp;');
      return `<a class="lesson-room-link" href="/map?${query}" data-room-map data-building="${escapeText(building)}" data-floor="${escapeText(floor)}" data-room="${escapeText(room)}">${escapeText(roomLabel)}</a>${teacher ? ' · ' + escapeText(teacher) : ''}`;
    }
  }
  return escapeText(detail);
}

function campusMap() {
  const campusBuildings = sectionData;
  const building = campusBuildings[mapBuilding];
  const rooms = building.floors[mapFloor];
  const room = rooms.find(([name]) => name === mapRoom);
  const roomButtons = items => items.map(([name,label]) =>
    `<button data-map-room="${escapeText(name)}" aria-pressed="${mapRoom === name}"><b>${escapeText(name)}</b><span>${escapeText(label)}</span></button>`).join('');
  const split = Math.ceil(rooms.length / 2);
  const stairs = '<div class="floor-stairs"><span aria-hidden="true"></span><b>Лестница</b></div>';
  return intro('', 'Карта') +
    `<div class="schedule-switch" aria-label="Корпус">${Object.entries(campusBuildings).map(([id,item]) => `<button data-map-building="${escapeText(id)}" aria-pressed="${id === mapBuilding}">${escapeText(item.name)}</button>`).join('')}</div>
    <p class="building-address">${escapeText(building.address)} · вымышленный адрес</p>
    <div class="schedule-switch" aria-label="Этаж">${Object.keys(building.floors).map(floor => `<button data-map-floor="${escapeText(floor)}" aria-pressed="${Number(floor) === mapFloor}">${escapeText(floor)} этаж</button>`).join('')}</div>
    <section class="panel" aria-label="Схема этажа">
    ${mapBuilding === 'lab' ? `<div class="floor-plan floor-plan-vertical">
      <div class="floor-wings">${roomButtons(rooms.slice(0, split))}</div>
      <div class="floor-spine">${stairs}<span>Коридор</span><b>${mapFloor === 1 ? 'Вход ↑' : 'Холл'}</b></div>
      <div class="floor-wings floor-wings-east">${roomButtons(rooms.slice(split))}</div></div>` : `<div class="floor-plan">
    <div class="floor-wings">${roomButtons(rooms.slice(0, split))}</div>
    <div class="floor-corridor"><span>${mapFloor === 1 ? '→ Вход с улицы' : '← Западное крыло'}</span><span>Коридор</span><span aria-hidden="true">→</span></div>
    <div class="floor-wings floor-wings-south">${roomButtons(rooms.slice(split))}
    ${stairs}</div></div>`}
    <p class="floor-description" aria-live="polite">${room ? `${escapeText(room[0])} · ${escapeText(room[1])} · этаж ${mapFloor}` : 'Нажми на аудиторию, чтобы посмотреть её назначение.'}</p></section>`;
}
