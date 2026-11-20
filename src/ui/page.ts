/**
 * Inline UI page for the zcontext realtime panel (ZCTX-UI DESIGN §3.5) — D3.
 *
 * Delivered as a single inline HTML string compiled into lib/index.js: zero
 * build, zero runtime fs read, zero path-traversal surface (DESIGN §3.5). The
 * bridge token placeholder is replaced by `registerUiRoutes` at registration
 * time, so the page is bound to the exact token of this process session.
 *
 * HARD RULES:
 *   - Written with the Write tool (Z23/条目32/A14: NEVER heredoc for HTML/JS).
 *   - The embedded JS uses string CONCATENATION, never `${...}` template syntax,
 *     so it cannot collide with this TS template literal's interpolation.
 *   - Data goes over same-origin HTTP only; the UI never enters the model
 *     stream or the session wire (V3/R1: no billed tokens are burned).
 *   - BETA honesty boundary: the UI solves "view/stats without opening a
 *     session"; it does NOT eliminate all fold tokens (autofold still spends).
 *
 * @module ui/page
 */

/**
 * The token placeholder (a plain marker, not a credential). registerUiRoutes
 * replaces every occurrence with the runtime-generated bridge token.
 */
export const UI_TOKEN_PLACEHOLDER = '__ZCTX_BRIDGE_TOKEN__'

/**
 * Complete single-file page: inline CSS + inline JS, three blocks
 * (查看 / 统计 / 设置), 5s polling, same-origin fetch with token header.
 */
export const UI_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zcontext 面板 · BETA</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
         background: #10131a; color: #e6e9ef; font-size: 14px; line-height: 1.5; }
  header { padding: 14px 20px; border-bottom: 1px solid #262c3a; display: flex;
           align-items: baseline; gap: 12px; flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 17px; font-weight: 650; }
  .beta { font-size: 11px; color: #f0b429; border: 1px solid #f0b429; border-radius: 4px;
          padding: 1px 6px; }
  .meta { margin-left: auto; color: #8b93a7; font-size: 12px; }
  .session-pick { color: #8b93a7; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
  .session-pick select { background: #0f131c; color: #e6e9ef; border: 1px solid #333b4e;
    border-radius: 5px; padding: 3px 6px; font-family: inherit; font-size: 12px; max-width: 220px; }
  main { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
         gap: 16px; padding: 18px 20px; max-width: 1500px; }
  section { background: #171b25; border: 1px solid #262c3a; border-radius: 10px;
            padding: 16px; min-width: 0; }
  section h2 { margin: 0 0 12px; font-size: 14px; font-weight: 650; color: #cdd4e3;
               border-bottom: 1px solid #262c3a; padding-bottom: 8px; }
  .row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
  .row .k { color: #8b93a7; }
  .row .v { font-variant-numeric: tabular-nums; text-align: right; }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; vertical-align: middle; }
  .measured { background: #1c4a2e; color: #7ee2a8; }
  .estimated { background: #4a3a1c; color: #e7c27a; }
  .unknown { background: #3a3f4d; color: #aeb6c7; }
  .none { background: #2a2f3b; color: #798195; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #222838; }
  th { color: #8b93a7; font-weight: 500; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .scroll { max-height: 220px; overflow: auto; }
  .face { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .dot.active { background: #3ecf8e; }
  .dot.degraded { background: #f0b429; }
  .dot.absent { background: #e05561; }
  .degraded-line { color: #e7c27a; font-size: 12px; }
  label.f { display: block; margin: 8px 0; }
  label.f span { display: block; color: #8b93a7; margin-bottom: 3px; }
  input[type=text], input[type=number], select { width: 100%; background: #0f131c; color: #e6e9ef;
    border: 1px solid #333b4e; border-radius: 5px; padding: 6px 8px; font-family: inherit; }
  .chk { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .chk input { width: auto; }
  button { background: #2f6fed; color: #fff; border: 0; border-radius: 6px;
           padding: 9px 16px; font-size: 14px; cursor: pointer; margin-top: 8px; }
  button:disabled { background: #394154; cursor: not-allowed; }
  .note { font-size: 12px; color: #8b93a7; margin-top: 10px; }
  .msg { font-size: 12px; margin-top: 8px; min-height: 16px; }
  .msg.ok { color: #7ee2a8; }
  .msg.err { color: #e05561; }
  .empty { color: #798195; font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>zcontext 实时面板</h1>
  <span class="beta">BETA</span>
  <button id="copy-address" title="复制本面板地址（可在任意浏览器打开）" style="margin-left:12px;font-size:12px;padding:3px 10px;cursor:pointer;">复制面板地址</button>
  <span id="copy-result" style="font-size:12px;color:var(--dsw-alias-label-secondary,#aaa)"></span>
  <label class="session-pick" id="session-pick-wrap" style="display:none">会话
    <select id="session-pick" aria-label="切换会话"></select>
  </label>
  <span class="meta" id="meta">加载中…</span>
</header>
<main>
  <section>
    <h2>查看 · 实时账本（5s 轮询）</h2>
    <div id="view-body"><div class="empty">暂无活动会话</div></div>
  </section>
  <section>
    <h2>统计 · 累计折叠 / 回本 / 缓存</h2>
    <div id="stats-body"><div class="empty">暂无活动会话</div></div>
  </section>
  <section>
    <h2>设置 · 配置 overlay</h2>
    <form id="settings-form"></form>
    <div class="msg" id="settings-msg"></div>
    <div class="note">保存后下次加载生效，不热更新已挂载的 face。写入仅经宿主 configEditor 落到 profile overlay。</div>
  </section>
</main>
<script>
(function () {
  'use strict';
  window.__ZCTX_TOKEN__ = '__ZCTX_BRIDGE_TOKEN__';
  var TOKEN = window.__ZCTX_TOKEN__;
  var session = null; // locked to first observed session id, then reused
  var formBuilt = false;

  function authHeaders(extra) {
    var h = { 'x-zctx-token': TOKEN };
    if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) h[k] = extra[k]; } }
    return h;
  }
  function api(path) {
    return fetch(path, { headers: authHeaders() }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Attribute-context alias (B5-6): same escaping, used where a value lands
  // inside a quoted HTML attribute. Text contexts also benefit (harmless).
  function escAttr(s) { return esc(s); }
  function badge(basis) {
    var b = basis || 'none';
    return '<span class="badge ' + b + '">' + b + '</span>';
  }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v.toLocaleString() : 'n/a'; }
  function rows(pairs) {
    return pairs.map(function (p) {
      return '<div class="row"><span class="k">' + esc(p[0]) + '</span><span class="v">' + p[1] + '</span></div>';
    }).join('');
  }
  function table(headers, data) {
    if (!data.length) return '<div class="empty">(空)</div>';
    var h = '<table><thead><tr>' + headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
    return h + data.map(function (cells) {
      return '<tr>' + cells.map(function (c, i) {
        return '<td' + (i > 0 ? ' class="num"' : '') + '>' + c + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
  }

  function renderView(s) {
    var w = s.window || {};
    var tt = w.totalTokens || {};
    var budget = s.budget || {};
    var face = s.faceHealth || {};
    var head = rows([
      ['会话', s.sessionId ? esc(s.sessionId) : '（无）'],
      ['解析路径', esc(s.sessionResolution || 'none')],
      ['上下文窗口', num(w.contextWindow) + badge('measured')],
      ['已用 tokens', num(tt.value) + badge(tt.basis)],
      ['压力', (typeof w.pressurePct === 'number' ? w.pressurePct.toFixed(1) + '%' : 'n/a')],
      ['路由', w.routed ? esc(w.routed.provider + '/' + w.routed.model) : 'n/a'],
      ['触发线', num(budget.triggerLine)],
      ['face 健康', '<span class="face"><span class="dot ' + esc(face.state || 'absent') + '"></span>' + esc(face.state || 'absent') + '</span>']
    ]);
    var cache = s.cache || {};
    var cl = rows([
      ['样本数', num(cache.samples)],
      ['cache 口径', badge(cache.basis)],
      ['缓存读取', cache.latest && cache.latest.cacheReadTokens !== undefined ? num(cache.latest.cacheReadTokens) + badge(cache.latest.measured ? 'measured' : 'estimated') : 'n/a'],
      ['缓存写入', cache.latest && cache.latest.cacheWriteTokens !== undefined ? num(cache.latest.cacheWriteTokens) : 'n/a']
    ]);
    var rangeRows = (s.ranges || []).map(function (r) {
      return [r.startSeq + '-' + r.endSeq, num(r.estimatedTokens), r.protected ? 'protected' : '可折叠'];
    });
    var foldRows = (s.folds || []).map(function (f) {
      return [esc(f.foldId), esc(f.status), f.startSeq + '-' + f.endSeq, num(f.tokensBefore - f.tokensAfter)];
    });
    var deg = (s.degraded || []).map(function (d) { return '<div class="degraded-line">- ' + esc(d) + '</div>'; }).join('');
    var faceDetail = (face.evidence || []).map(function (e) {
      return '<div class="degraded-line">' + (e.ok ? '[OK] ' : '[--] ') + esc(e.signal) + ': ' + esc(e.detail) + '</div>';
    }).join('');
    document.getElementById('view-body').innerHTML =
      head +
      '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">窗口 / 预算 / 缓存</h2>' +
      // budget six lines appended below
      rows([
        ['max output cap', num(budget.maxOutputCap)],
        ['reserve', num(budget.reserve)],
        ['pessimistic reserve', num(budget.pessimisticReserve)],
        ['keep-recent', num(budget.keepRecent)],
        ['summary input cap', num(budget.summaryInputCap)],
        ['reply cap', num(budget.replyCap)]
      ]) + cl +
      '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">可折叠区间</h2>' +
      '<div class="scroll">' + table(['区间 seq', '估算 tokens', '状态'], rangeRows) + '</div>' +
      '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">折叠账本</h2>' +
      '<div class="scroll">' + table(['foldId', '状态', '覆盖', '净省'], foldRows) + '</div>' +
      (face.summary ? '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">face 诊断</h2><div class="degraded-line">' + esc(face.summary) + '</div>' + faceDetail : '') +
      deg;
  }

  function renderStats(s) {
    var a = s.attribution || {};
    var ts = a.threeState || { measured: 0, semi: 0, estimated: 0 };
    var total = ts.measured + ts.semi + ts.estimated;
    var pct = function (n) { return total > 0 ? (n / total * 100).toFixed(1) + '%' : '0%'; };
    var repaid = (a.breakevenTable || []).filter(function (r) { return r.repaid === true; }).length;
    var head = rows([
      ['累计折叠', num(a.foldCount)],
      ['净省 tokens', num(a.netTokensSaved && a.netTokensSaved.value) + badge(a.netTokensSaved && a.netTokensSaved.basis)],
      ['回本次数', num(repaid) + ' / ' + num((a.breakevenTable || []).length)],
      ['纯净样本占比', (typeof a.cleanSampleRatio === 'number' ? (a.cleanSampleRatio * 100).toFixed(1) + '%' : 'n/a') + (a.clean ? ' [可信]' : ' [不足·结论保留]')],
      ['三态 measured', pct(ts.measured) + badge('measured')],
      ['三态 semi', pct(ts.semi)],
      ['三态 estimated', pct(ts.estimated) + badge('estimated')],
      ['cache 实测占比', badge(s.cache && s.cache.basis)]
    ]);
    var resetRows = (a.resetSummary || []).map(function (r) { return [esc(r.kind), num(r.count)]; });
    document.getElementById('stats-body').innerHTML =
      head +
      '<h2 style="font-size:12px;margin:12px 0 4px;border:0;padding:0">重置台账摘要</h2>' +
      table(['类型', '次数'], resetRows);
  }

  var FIELDS = [
    ['enabled', 'enabled (boolean)', 'boolean'],
    ['nudgeThresholds', 'nudgeThresholds', 'text'],
    ['keepRecentTokens', 'keepRecentTokens', 'number'],
    ['maxFoldFraction', 'maxFoldFraction', 'number'],
    ['minFoldableTokens', 'minFoldableTokens', 'number'],
    ['protectionFloorTokens', 'protectionFloorTokens', 'number'],
    ['summaryFloorChars', 'summaryFloorChars', 'number'],
    ['summaryCeilingChars', 'summaryCeilingChars', 'number'],
    ['netShrinkTolerance', 'netShrinkTolerance', 'number']
  ];
  var SWITCHES = [
    ['observe.enabled', 'observe.enabled'],
    ['patch.guardObserveEvents', 'patch.guardObserveEvents'],
    ['autofold.enabled', 'autofold.enabled']
  ];

  function buildForm(cfg) {
    if (formBuilt) return;
    var f = cfg.fields || {}, fs = cfg.faceSwitches || {};
    var html = '';
    FIELDS.forEach(function (spec) {
      var key = spec[0], label = spec[1], type = spec[2];
      var val = f[key];
      if (type === 'boolean') {
        html += '<label class="chk"><input type="checkbox" data-key="' + key + '" data-type="boolean"' + (val === true ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
      } else {
        html += '<label class="f"><span>' + esc(label) + '</span><input type="text" data-key="' + escAttr(key) + '" data-type="' + escAttr(type) + '" value="' + escAttr(val === undefined ? '' : val) + '"></label>';
      }
    });
    html += '<h2 style="font-size:12px;margin:14px 0 4px;border:0;padding:0">face 开关</h2>';
    SWITCHES.forEach(function (spec) {
      var key = spec[0], label = spec[1];
      var val = fs[key] !== undefined ? fs[key] : f[key];
      html += '<label class="chk"><input type="checkbox" data-key="' + key + '" data-type="boolean"' + (val === true ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
    });
    html += '<label class="f"><span>preflightMode (off|observe|enforce)</span><select data-key="preflightMode" data-type="select">' +
      ['off', 'observe', 'enforce'].map(function (m) {
        var cur = fs.preflightMode !== undefined ? fs.preflightMode : f.preflightMode;
        return '<option value="' + m + '"' + (cur === m ? ' selected' : '') + '>' + m + '</option>';
      }).join('') + '</select></label>';
    html += '<button type="submit" id="settings-save"' + (cfg.writable ? '' : ' disabled') + '>保存 overlay</button>';
    if (!cfg.writable) html += '<div class="note">当前 composition 无 configEditor，设置只读。</div>';
    document.getElementById('settings-form').innerHTML = html;
    formBuilt = true;
    document.getElementById('settings-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveSettings();
    });
  }

  function saveSettings() {
    var form = document.getElementById('settings-form');
    var patch = {};
    var inputs = form.querySelectorAll('[data-key]');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var key = el.getAttribute('data-key');
      var type = el.getAttribute('data-type');
      if (type === 'boolean') patch[key] = !!el.checked;
      else if (type === 'number') { var n = Number(el.value); patch[key] = isFinite(n) ? n : el.value; }
      else patch[key] = el.value;
    }
    var msg = document.getElementById('settings-msg');
    msg.className = 'msg';
    msg.textContent = '保存中…';
    fetch('/zctx-ui/api/config', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(patch)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      msg.className = 'msg ' + (res.ok ? 'ok' : 'err');
      msg.textContent = res.ok ? '已保存，下次加载生效。' : ('保存失败：' + (res.body && res.body.error || ('HTTP ' + (res.ok ? 200 : 500))));
    }).catch(function (e) {
      msg.className = 'msg err';
      msg.textContent = '保存失败：' + e.message;
    });
  }

  function renderSessionPicker(ids, current) {
    var wrap = document.getElementById('session-pick-wrap');
    var select = document.getElementById('session-pick');
    if (!wrap || !select) return;
    if (!ids || ids.length < 2) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    var prev = select.value;
    var chosen = current || prev || ids[0];
    var html = ids.map(function (id) {
      return '<option value="' + escAttr(id) + '"' + (id === chosen ? ' selected' : '') + '>' + esc(id) + '</option>';
    }).join('');
    if (select.innerHTML !== html) {
      select.innerHTML = html;
      select.value = chosen;
    }
  }

  function refresh() {
    var url = '/zctx-ui/api/snapshot' + (session ? '?session=' + encodeURIComponent(session) : '');
    api(url).then(function (s) {
      if (!session && s.sessionId) session = s.sessionId;
      renderSessionPicker(s.availableSessions || [], session || s.sessionId);
      document.getElementById('meta').textContent =
        (s.sessionId ? esc(s.sessionId) : '无会话') + ' · ' + new Date(s.generatedAt).toLocaleTimeString();
      renderView(s);
      renderStats(s);
    }).catch(function (e) {
      document.getElementById('meta').textContent = '快照读取失败：' + e.message;
    });
    if (!formBuilt) {
      api('/zctx-ui/api/config').then(buildForm).catch(function () { /* settings stay empty on error */ });
    }
  }

  var pick = document.getElementById('session-pick');
  if (pick) {
    pick.addEventListener('change', function () {
      session = pick.value; // user switch: lock to the chosen session, re-poll now
      refresh();
    });
  }

  refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>
`
