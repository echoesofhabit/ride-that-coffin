const leaderboard = (() => {
  const el = id => document.getElementById(id);
  const online = /^https?:$/.test(location.protocol);
  const panel = el('worldBoard');
  const status = el('rankMessage');
  const nameField = el('rankName');
  const prefix = 'coffin-doors-';
  function read(key) {
    try { return JSON.parse(localStorage.getItem(prefix + key)); } catch { return null; }
  }
  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(prefix + key);
      else localStorage.setItem(prefix + key, JSON.stringify(value));
    } catch {}
  }
  const better = (a, b) => !b || a.doors > b.doors || (a.doors === b.doors && a.progress > b.progress);
  const label = s => s.doors + (s.doors === 1 ? ' door' : ' doors') + ' · ' + s.progress + '% to next';
  let nickname = read('name') || '';
  let pending = read('pending'), deviceBest = read('best'), personal = null;
  let offered = null, fetching = null, active = null, sending = false, boardVersion = 0;
  nameField.value = nickname;
  function keep(run) { pending = run; store('pending', run); }
  function dropExpired() { if (pending && pending.expires <= Date.now()) keep(null); }
  dropExpired();

  async function api(op, data) {
    const res = await fetch('/api/ranking/' + op, {
      method: data ? 'POST' : 'GET', credentials: 'same-origin',
      headers: data ? {'Content-Type':'application/json'} : {}, body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const error = new Error(payload.error || 'World ranking unavailable.');
      error.status = res.status;
      throw error;
    }
    return res.json();
  }
  function prepare() {
    if (!online || fetching || (offered && offered.expires > Date.now() + 120000)) return;
    offered = null;
    fetching = api('start', {}).then(t => {
      if (t.ticket && Number.isInteger(t.seed)) offered = t;
    }).catch(() => {}).finally(() => { fetching = null; });
  }
  function begin() {
    active = offered && offered.expires > Date.now() + 120000
      ? {...offered, events: [], steps: 0} : null;
    offered = null;
    return active?.seed;
  }
  function event(op, n) {
    if (!active) return;
    const events = active.events, last = events.at(-1);
    if (typeof op === 'number') {
      active.steps += n;
      if (active.steps > 108000) { active = null; return; }
      if (last?.[0] === op) { last[1] += n; return; }
    }
    if (events.length >= 30000) { active = null; return; }
    events.push([op, n]);
  }
  function showWorld() {
    el('myRank').textContent = personal ? 'World #' + personal.rank + ' · ' + label(personal) : '';
    el('shareRank').disabled = !personal;
  }
  async function refresh() {
    if (!online) { el('boardStatus').textContent = 'World rankings require an online game.'; return false; }
    const version = ++boardVersion;
    try {
      const board = await api('board');
      if (version !== boardVersion) return false;
      personal = board.me; showWorld();
      const list = el('rankRows'); list.replaceChildren();
      for (const row of board.top) {
        const tr = document.createElement('tr');
        if (row.mine) tr.className = 'myRank';
        for (const value of [row.rank, row.nickname, row.doors, row.progress + '%']) {
          const td = document.createElement('td'); td.textContent = value; tr.append(td);
        }
        list.append(tr);
      }
      el('boardStatus').textContent = board.top.length ? '' : 'No records yet.';
      el('boardMe').textContent = el('myRank').textContent || 'No world record for this browser yet.';
      return true;
    } catch {
      if (version === boardVersion) el('boardStatus').textContent = 'Could not load the world ranking.';
      return false;
    }
  }
  async function submit() {
    if (sending || !pending || !nickname || !online) return;
    const item = pending;
    el('retryRank').hidden = true;
    if (item.expires <= Date.now()) {
      keep(null); status.textContent = 'Entry expired. Your device best is kept.'; return;
    }
    sending = true;
    status.textContent = 'Verifying your run…';
    let completed = false;
    try {
      await api('finish', {nickname, ticket: item.ticket, events: item.events});
      completed = true;
      if (pending === item) keep(null);
      status.textContent = 'Run verified.';
      await refresh();
    } catch (err) {
      if (pending === item && [400, 403, 413, 422].includes(err.status)) {
        keep(null); status.textContent = 'World entry could not be verified. Your device best is kept.';
      } else {
        status.textContent = 'Upload pending. Retry when connected.'; el('retryRank').hidden = false;
      }
    } finally {
      sending = false;
      if (pending && pending !== item && (completed || pending.expires > Date.now())) submit();
    }
  }
  function finished(s) {
    const score = doorScore(s, gateDistance);
    if (better(score, deviceBest)) { deviceBest = score; store('best', score); }
    el('deviceBest').textContent = 'Device best · ' + label(deviceBest);
    dropExpired();
    const eligible = active && active.expires > Date.now();
    if (eligible && better(score, personal) && better(score, pending))
      keep({...score, ticket: active.ticket, expires: active.expires, events: active.events});
    active = null;
    el('rankForm').hidden = !!nickname || !pending;
    el('retryRank').hidden = true;
    if (pending) {
      if (nickname) submit();
      else status.textContent = 'Enter your nickname to post your best run.';
    } else {
      status.textContent = eligible ? '' : 'This run counts on this device only.';
      if (online) refresh();
    }
    prepare();
  }
  el('rankForm').onsubmit = e => {
    e.preventDefault();
    const input = nameField.value.normalize('NFC').trim();
    if (!/^[\p{L}\p{M}\p{N} _.-]{1,18}$/u.test(input)) {
      status.textContent = 'Use 1–18 letters, numbers, spaces, dots, dashes or underscores.'; return;
    }
    nickname = input; store('name', nickname); el('rankForm').hidden = true; submit();
  };
  el('retryRank').onclick = submit;
  el('resultRanks').onclick = () => {
    panel.showModal(); el('boardStatus').textContent = 'Loading…'; refresh();
  };
  el('closeRank').onclick = () => panel.close();
  el('shareRank').onclick = async () => {
    if (!personal) return;
    const url = location.origin + location.pathname;
    const text = 'Ride That Coffin! ' + personal.nickname + ' · ' + label(personal) + ' · World #' + personal.rank;
    try {
      if (navigator.share) await navigator.share({title:'Ride That Coffin!', text, url});
      else { await navigator.clipboard.writeText(text + ' ' + url); el('boardStatus').textContent = 'Copied for sharing.'; }
    } catch (err) { if (err.name !== 'AbortError') el('boardStatus').textContent = text + ' ' + url; }
  };
  window.addEventListener('online', () => { prepare(); submit(); });
  prepare();
  if (pending && nickname) submit();
  return {prepare, begin, event, finished};
})();
