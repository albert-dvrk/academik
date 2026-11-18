function auth() {
  return `<div class="login-layout">
    <div class="login-brand"><div class="brand">${iconMarkup('graduation-cap')}<div><b>Академик</b><small>Конкурсный концепт</small></div></div>
    <p>Меньше поисков — больше времени поспать.</p></div>
    <form class="panel" data-form="auth">${intro('','Вход','Войди по студенческой почте и паролю.')}
    <label>Студенческая почта<input name="email" type="email" autocomplete="username" maxlength="254" required></label>
    <label>Пароль<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label>
    <p role="alert"></p><button class="action">Войти</button>
    <p class="footer-note">Используйте выданный демо-аккаунт.</p></form></div>`;
}
let supportThreadId;
function supportPage() {
  const {topics, messages} = sectionData;
  const threads = new Map();
  for (const message of messages) {
    if (!threads.has(message.thread_id)) threads.set(message.thread_id, []);
    threads.get(message.thread_id).push(message);
  }
  const ordered = [...threads.values()].sort((a, b) => b.at(-1).id - a.at(-1).id);
  const active = supportThreadId === undefined ? ordered[0] : threads.get(supportThreadId);
  const activeId = active?.[0].thread_id;
  const title = active ? topics[active[0].topic] : 'Новый чат';
  const log = active ? active.map(({message, reply}) =>
    `<p class="question">${escapeText(message)}</p>${reply ? `<p>${escapeText(reply)}</p>` : ''}`
  ).join('') : '';
  const topicSelect = `<div class="semester-picker support-topic-picker">
    <span id="support-topic-label">Тема обращения</span>
    <input type="hidden" name="topic" value="">
    <button type="button" class="semester-trigger" popovertarget="support-topic-options" aria-labelledby="support-topic-label support-topic-value">
      <span id="support-topic-value">Выбери тему</span>${iconMarkup('chevron-down')}
    </button>
    <div id="support-topic-options" popover aria-labelledby="support-topic-label">
      ${Object.entries(topics).map(([id, name]) => `<button type="button" data-support-topic="${id}" aria-pressed="false">${escapeText(name)}</button>`).join('')}
    </div>
  </div>`;
  const chatList = ordered.map(thread => {
    const first = thread[0];
    return `<li><button data-support-thread="${first.thread_id}" ${first.thread_id === activeId ? 'aria-current="true"' : ''}>
      <strong>${escapeText(topics[first.topic])}</strong><span>${escapeText(thread.at(-1).message)}</span>
    </button></li>`;
  }).join('');

  return `<div class="section-header support-header">${intro('', 'Техническая поддержка')}<button class="support-back" data-page="profile">К профилю</button></div>
    <div class="support-layout">
      <section class="panel support-thread" aria-labelledby="support-chat-title">
        <h2 id="support-chat-title">${escapeText(title)}</h2>
        ${active ? `<div class="support-log" role="log" aria-label="Сообщения" tabindex="0">${log}</div>` : ''}
        <form data-form="support" ${active ? `data-thread-id="${activeId}"` : ''}>
          ${active ? '' : topicSelect}
          <label>Сообщение<textarea name="message" maxlength="250" placeholder="Напиши сообщение…" required></textarea></label>
          <p role="alert"></p><button type="submit" class="action">Отправить</button>
        </form>
      </section>
      <aside class="panel support-sidebar" aria-labelledby="support-list-title">
        <h2 id="support-list-title">Чаты</h2>
        <button class="action" data-support-new>+ Новый чат</button>
        ${chatList ? `<ul class="support-list">${chatList}</ul>` : '<p class="sub">Обращений пока нет.</p>'}
      </aside>
    </div>`;
}
const screens = {today,schedule,compare:schedule,grades,requests:requestPage,news,campus:campusNews,profile,map:campusMap,support:supportPage,login:auth};
function render() {
  const guest = page === 'login';
  placeNavigation();
  avatar.hidden = guest;
  avatar.innerHTML = `<span class="avatar-initials">${avatarContent(studentProfile)}</span><span class="tool-label">Профиль</span>`;
  if (page === 'profile') avatar.setAttribute('aria-current', 'page');
  else avatar.removeAttribute('aria-current');
  const noticeButton = root.querySelector('.notice');
  const unread = (studentProfile?.unreadCount ?? 0) + (studentProfile?.newsUnreadCount ?? 0);
  noticeButton.hidden = guest;
  noticeButton.setAttribute('aria-label', unread ? `Уведомления и новости, непрочитанных: ${unread}` : 'Уведомления и новости');
  noticeButton.innerHTML = `<span class="notice-icon">${iconMarkup('bell')}${unread ? `<span class="notice-count" aria-hidden="true">${unread}</span>` : ''}</span><span class="tool-label">Уведомления</span>`;
  if (page === 'news' || page === 'campus') noticeButton.setAttribute('aria-current', 'page');
  else noticeButton.removeAttribute('aria-current');
  root.dataset.theme = guest ? 'light' : theme;
  root.dataset.guest = String(guest);
  nav.hidden = guest;
  main.innerHTML = guest || sectionData ? screens[page]()
    : '<p role="status">Загрузка…</p>';
  const supportLog = main.querySelector('.support-log');
  if (supportLog) supportLog.scrollTop = supportLog.scrollHeight;
  nav.innerHTML = guest ? '' : sections.map(([id,label,icon]) => {
    const count = studentProfile?.[sectionCounters[id]] ?? 0;
    const active = id === page || (id === 'schedule' && page === 'compare');
    return `<button data-page="${id}" aria-label="${label}${count ? ', непрочитанных: ' + count : ''}" title="${label}" ${active ? 'aria-current="page"' : ''}><span class="icon">${iconMarkup(icon)}${count ? `<span class="notice-count" aria-hidden="true">${count}</span>` : ''}</span><span class="nav-label">${label}</span></button>`;
  }).join('');
}

main.addEventListener('toggle', event => {
  const card = event.target;
  if (page !== 'requests' || !card.isConnected || !card.matches('.request-card')) return;
  const id = Number(card.id.slice('request-'.length));
  if (card.open) {
    openRequestId = id;
    const chat = card.querySelector('.request-chat-scroll');
    chat.scrollTop = chat.scrollHeight;
  }
  else if (openRequestId === id) openRequestId = undefined;
  saveSectionState();
}, true);

root.addEventListener('click', async event => {
  const roomLink = event.target.closest('[data-room-map]');
  if (roomLink && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    if (pending) return;
    mapBuilding = roomLink.dataset.building;
    mapFloor = Number(roomLink.dataset.floor);
    mapRoom = roomLink.dataset.room;
    main.scrollTop = 0;
    await openSection('map', 'pushState');
    main.querySelector('[data-map-room][aria-pressed=true]')?.focus();
    return;
  }
  const button = event.target.closest('button');
  if (!button || pending) return;
  if (button.dataset.calendarMonth) {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + Number(button.dataset.calendarMonth), 1);
    const calendar = button.closest('.schedule-calendar');
    calendar.innerHTML = calendarGrid(calendar.dataset.selectedDate);
    calendar.querySelector(`[data-calendar-month="${button.dataset.calendarMonth}"]`).focus();
    return;
  } else if (button.dataset.calendarDate) {
    jumpToDate(button.dataset.calendarDate);
    await openSection(page);
    main.querySelector('.calendar-trigger')?.focus();
    return;
  } else if (button.hasAttribute('data-theme-toggle')) {
    theme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('pulse-theme', theme);
  } else if (button.hasAttribute('data-logout')) {
    pending = true;
    try {
      await api('/api/logout', {});
      showLogin();
      signInTarget = 'today';
      requestForm = false;
      selectedSemester = undefined;
      openRequestId = undefined;
      mode = 'day';
      day = undefined;
      weekOffset = 0;
      comparisonTargets = [];
    } catch (error) {
      showError(error);
      return;
    } finally {
      pending = false;
    }
  } else if (button.dataset.page) {
    page = button.dataset.page;
    const requestId = Number(button.dataset.openRequest);
    if (page === 'requests' && requestId) openRequestId = requestId;
    main.scrollTop = 0;
    if (page === 'schedule' && !nav.contains(button) && !button.hasAttribute('data-keep-schedule')) {
      mode = 'day';
      if (button.dataset.transfer) {
        jumpToDate(button.dataset.transfer);
      }
    }
    await openSection(page, 'pushState');
    if (page === 'requests' && requestId) revealRequest(requestId);
    return;
  } else if (button.dataset.mode) {
    mode = button.dataset.mode;
    if (mode === 'day') {
      weekOffset = 0;
      day = undefined;
    }
    await openSection(page);
    return;
  } else if (button.dataset.week) {
    weekOffset += Number(button.dataset.week);
    await openSection(page);
    main.querySelector(`[data-week="${button.dataset.week}"]`)?.focus();
    return;
  } else if (button.dataset.day !== undefined) {
    day = Number(button.dataset.day);
    if (page === 'compare') {
      await openSection(page);
      return;
    }
  } else if (button.dataset.addTarget) {
    const target = comparisonOptions.find(option => option.id === button.dataset.addTarget);
    if (target && comparisonTargets.length < sectionData.comparison.maxTargets && !comparisonTargets.some(option => option.id === target.id)) {
      await updateComparison([...comparisonTargets, target]);
    }
    return;
  } else if (button.dataset.removeTarget) {
    await updateComparison(comparisonTargets.filter(option => option.id !== button.dataset.removeTarget));
    return;
  } else if (button.dataset.mapBuilding) {
    mapBuilding = button.dataset.mapBuilding;
    mapFloor = 1;
    mapRoom = undefined;
  } else if (button.dataset.mapFloor) {
    mapFloor = Number(button.dataset.mapFloor);
    mapRoom = undefined;
  } else if (button.dataset.mapRoom) {
    mapRoom = button.dataset.mapRoom;
  } else if (button.hasAttribute('data-avatar-edit')) {
    main.querySelector('[data-avatar-file]').click();
    return;
  } else if (button.hasAttribute('data-support-new') || button.dataset.supportThread) {
    supportThreadId = button.dataset.supportThread ? Number(button.dataset.supportThread) : null;
    render();
    main.querySelector(supportThreadId ? '.support-log' : '.support-topic-picker .semester-trigger')?.focus();
    return;
  } else if (button.hasAttribute('data-new')) {
    requestForm = true;
  } else if (button.hasAttribute('data-cancel')) {
    requestForm = false;
  } else if (button.dataset.requestType || button.dataset.supportTopic) {
    const {requestType, supportTopic} = button.dataset;
    const form = button.closest('form');
    const trigger = form.querySelector('.semester-trigger');
    const options = button.parentElement;
    form.elements[supportTopic ? 'topic' : 'type'].value = supportTopic || requestType;
    trigger.querySelector('span').textContent = button.textContent;
    for (const option of options.querySelectorAll('button')) option.setAttribute('aria-pressed', String(option === button));
    if (requestType) {
      trigger.setAttribute('aria-label', 'Тип заявки: ' + requestType);
      form.querySelector('.request-guide').innerHTML = requestGuide(requestType);
      const needsPurpose = requestType === educationCertificateType;
      form.querySelector('.request-purpose').hidden = !needsPurpose;
      form.elements.purpose.disabled = !needsPurpose;
      form.querySelector('[role="alert"]').textContent = '';
    } else {
      form.querySelector('[role="alert"]').textContent = '';
    }
    options.hidePopover();
    trigger.focus();
    return;
  } else if (button.dataset.pickSemester) {
    selectedSemester = Number(button.dataset.pickSemester);
    await openSection(page);
    main.querySelector('.semester-trigger')?.focus();
    return;
  } else if (button.hasAttribute('data-read-notifications')) {
    pending = true;
    button.disabled = true;
    try {
      const {unreadCount} = await api(`/api${pagePaths[page]}/read`, {});
      sectionData.unreadCount = unreadCount;
      studentProfile[sectionCounters[page]] = unreadCount;
    } catch (error) {
      showError(error);
      return;
    } finally {
      pending = false;
      button.disabled = false;
    }
  } else return;
  render();
  if (button.dataset.day !== undefined || button.dataset.mapBuilding || button.dataset.mapFloor || button.dataset.mapRoom) saveSectionState();
});
const cropDialog = root.querySelector('.avatar-crop');
const cropForm = cropDialog.querySelector('form');
const cropCanvas = cropDialog.querySelector('canvas');
let cropBitmap;

function drawAvatarCrop() {
  const {zoom, x, y} = cropForm.elements;
  const size = Math.min(cropBitmap.width, cropBitmap.height) / Number(zoom.value);
  const context = cropCanvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 256, 256);
  context.drawImage(cropBitmap, (cropBitmap.width - size) * Number(x.value),
    (cropBitmap.height - size) * Number(y.value), size, size, 0, 0, 256, 256);
}

cropForm.addEventListener('input', drawAvatarCrop);
cropForm.addEventListener('submit', event => {
  event.stopPropagation();
  cropDialog.close(event.submitter?.value ?? 'cancel');
  event.preventDefault();
});
cropDialog.addEventListener('close', async () => {
  cropBitmap?.close();
  cropBitmap = undefined;
  try {
    if (cropDialog.returnValue !== 'save') return;
    await api('/api/profile/avatar', {image:cropCanvas.toDataURL('image/jpeg', 0.85).split(',')[1]});
    studentProfile.hasAvatar = true;
    avatarVersion++;
    render();
  } catch (error) {
    if (error.status === 401) showLogin();
    showError(error);
  } finally {
    pending = false;
    main.querySelector('[data-avatar-edit]')?.focus();
  }
});

root.addEventListener('change', async event => {
  if (pending) return;
  if (event.target.matches('[data-avatar-file]')) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    pending = true;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Выбери изображение до 5 МБ.');
      cropBitmap = await createImageBitmap(file);
      cropForm.reset();
      cropDialog.returnValue = 'cancel';
      drawAvatarCrop();
      cropDialog.showModal();
    } catch (error) {
      if (error.status === 401) showLogin();
      showError({status: error.status || 400, message: error.status ? error.message : 'Не удалось загрузить фото. Выбери JPG, PNG или WebP до 5 МБ.'});
      cropBitmap?.close();
      cropBitmap = undefined;
      pending = false;
    }
    return;
  }
});
root.addEventListener('input', event => {
  const input = event.target;
  if (!input.matches('[data-comparison-search]')) return;
  clearTimeout(comparisonTimer);
  const output = main.querySelector('[data-comparison-options]');
  const term = input.value.trim();
  comparisonOptions = [];
  output.replaceChildren();
  if (!term) return;
  comparisonTimer = setTimeout(async () => {
    try {
      const {options} = await api('/api/schedule/options?' + new URLSearchParams({q:term}));
      if (!input.isConnected || input.value.trim() !== term) return;
      comparisonOptions = options.filter(option => !comparisonTargets.some(item => item.id === option.id));
      for (const option of comparisonOptions) {
        const item = document.createElement('button');
        item.type = 'button';
        item.dataset.addTarget = option.id;
        item.textContent = option.name + (option.kind === 'group' ? ' · группа' : ' · преподаватель');
        output.append(item);
      }
      if (!comparisonOptions.length) output.textContent = 'Совпадений нет.';
    } catch {
      if (input.isConnected && input.value.trim() === term) output.textContent = 'Подсказки недоступны. Попробуй ещё раз.';
    }
  }, 150);
});
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showError(error) {
  let message = main.querySelector('[role="alert"]');
  if (!message) {
    message = document.createElement('p');
    message.setAttribute('role', 'alert');
    main.prepend(message);
  }
  message.textContent = error.status ? error.message : 'Сервер недоступен. Попробуй ещё раз.';
}

function showLogin() {
  studentProfile = undefined;
  sectionData = undefined;
  supportThreadId = undefined;
  page = 'login';
  history.replaceState(null, '', pagePaths.login);
  render();
}

async function loadSection(target, historyMethod) {
  page = target;
  if (target !== 'support') supportThreadId = undefined;
  sectionData = undefined;
  render();
  if (target === 'profile') {
    sectionData = studentProfile;
  } else if (target === 'schedule' || target === 'compare') {
    const date = mode === 'week' ? weekDates(weekOffset)[0] : new Date();
    const query = new URLSearchParams({date:dateISO(date)});
    sectionData = await api(`/api/schedule/${mode === 'week' ? 'week' : 'today'}?${query}`);
    if (target === 'compare') {
      sectionData.comparison = await fetchComparison(sectionData, comparisonTargets);
    }
  } else if (target === 'map') {
    sectionData = await api('/api/map');
    studentProfile.campusMap = sectionData;
    if (!Object.hasOwn(sectionData, mapBuilding)) mapBuilding = Object.keys(sectionData)[0];
    const floors = sectionData[mapBuilding].floors;
    if (!Object.hasOwn(floors, mapFloor)) mapFloor = Number(Object.keys(floors)[0]);
  } else if (target === 'grades') {
    sectionData = await api(`/api/points?${new URLSearchParams({semester:selectedSemester ?? 'current'})}`);
    if (!sectionData.semesters.includes(selectedSemester)) selectedSemester = undefined;
  } else {
    const query = target === 'today' ? `?date=${dateISO(new Date())}` : '';
    sectionData = await api(`/api${pagePaths[target]}${query}`);
  }
  if (sectionCounters[target]) studentProfile[sectionCounters[target]] = sectionData.unreadCount;
  saveSectionState(historyMethod);
  render();
}

async function openSection(target, historyMethod) {
  pending = true;
  try {
    await loadSection(target, historyMethod);
  } catch (error) {
    if (error.status === 401) {
      signInTarget = target;
      showLogin();
    } else {
      main.innerHTML = '';
    }
    showError(error);
  } finally {
    pending = false;
  }
}

window.addEventListener('popstate', () => {
  const target = pageFromLocation();
  restoreSectionState(target);
  if (!studentProfile) {
    signInTarget = target === 'login' ? 'today' : target;
    showLogin();
  } else if (!pending) {
    openSection(target === 'login' ? 'today' : target, 'replaceState');
  }
});

root.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  const form = event.target;
  const body = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'support' && !form.dataset.threadId && !body.topic) {
    form.querySelector('[role="alert"]').textContent = 'Выбери тему обращения.';
    form.querySelector('.semester-trigger').focus();
    return;
  }
  const submit = form.querySelector('button[type="submit"], button.action');
  pending = true;
  submit.disabled = true;
  try {
    if (form.dataset.form === 'support') {
      const destination = form.dataset.threadId
        ? {thread_id:Number(form.dataset.threadId)}
        : {topic:Number(body.topic)};
      const message = await api('/api/support', {...destination, message:body.message});
      sectionData.messages.push(message);
      supportThreadId = message.thread_id;
      render();
      main.querySelector('[data-form="support"] textarea').focus();
      return;
    }
    if (form.dataset.form === 'request-message') {
      const request = sectionData.requests.find(item => item.id === Number(form.dataset.requestId));
      const {request: updated, unreadCount, ...message} = await api(`/api/requests/${request.id}/messages`, body);
      if (updated) {
        Object.assign(request, updated);
        sectionData.unreadCount = studentProfile.requestUnreadCount = unreadCount;
        render();
        revealRequest(request.id);
        return;
      }
      request.messages.push(message);
      const card = form.closest('.request-card');
      card.querySelector('.chat-empty')?.remove();
      card.querySelector('.request-chat').insertAdjacentHTML('beforeend', chatMessage(message));
      const chat = card.querySelector('.request-chat-scroll');
      chat.scrollTop = chat.scrollHeight;
      form.querySelector('[role="alert"]').textContent = '';
      form.reset();
      form.elements.message.focus();
      return;
    } else if (form.dataset.form === 'request') {
      const {unreadCount, ...request} = await api('/api/requests', body);
      sectionData.requests.unshift(request);
      sectionData.unreadCount = studentProfile.requestUnreadCount = unreadCount;
      requestForm = false;
      render();
      revealRequest(request.id);
      return;
    } else {
      studentProfile = await api('/api/login', body);
      await openSection(signInTarget, 'replaceState');
    }
    render();
  } catch (error) {
    if (form.dataset.form === 'support' && error.status !== 401) {
      form.querySelector('[role="alert"]').textContent = error.message || 'Сообщение не отправилось.';
      return;
    }
    if (form.dataset.form !== 'auth' && error.status === 401) {
      requestForm = false;
      signInTarget = form.dataset.form === 'support' ? 'support' : 'requests';
      showLogin();
    } else if (form.dataset.form === 'request-message') {
      form.querySelector('[role="alert"]').textContent = error.status ? error.message : 'Сообщение не отправилось. Попробуй ещё раз.';
      return;
    }
    showError(error);
  } finally {
    submit.disabled = false;
    pending = false;
  }
});

async function initialize() {
  restoreSectionState(signInTarget);
  pending = true;
  try {
    studentProfile = await api('/api/profile');
    await openSection(signInTarget, 'replaceState');
  } catch (error) {
    showLogin();
    if (error.status !== 401) showError(error);
    return;
  } finally {
    pending = false;
  }
}
initialize();
