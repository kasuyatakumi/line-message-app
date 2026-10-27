/**
 * Api.gs
 * 各 action の本体。Main.gs の doPost から呼ばれる。
 * 書き込み系は Main.gs 側で LockService により排他される。
 */

/** levels から level に一致する行を返す（文字列化して比較）。 */
function findLevelRow_(level) {
  var rows = readAll_('levels');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].level) === String(level)) return rows[i];
  }
  return null;
}

/** scenes から id に一致する行を返す。 */
function findSceneRow_(sceneId) {
  if (!sceneId) return null;
  var rows = readAll_('scenes');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(sceneId)) return rows[i];
  }
  return null;
}

/** candidates から id に一致する行を返す。 */
function findCandidateById_(id) {
  if (!id) return null;
  var rows = readAll_('candidates');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id)) return rows[i];
  }
  return null;
}

/** 同名の求職者を返す（name 完全一致）。 */
function findCandidateByName_(name) {
  if (!name) return null;
  var rows = readAll_('candidates');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name) === String(name)) return rows[i];
  }
  return null;
}

/** 呼び方の既定値を作る（姓＋さん。スペース区切りの先頭）。 */
function defaultCallName_(name) {
  var n = String(name || '').trim();
  if (!n) return '';
  var head = n.split(/\s+/)[0];
  return (head || n) + 'さん';
}

/**
 * 新しい求職者を登録する（同名がいれば流用）。
 * 返り値: 求職者行オブジェクト。
 */
function registerCandidate_(name, level) {
  var existing = findCandidateByName_(name);
  if (existing) return existing;
  var now = nowStr_();
  var id = nextId_('candidates');
  var rec = {
    id: id,
    name: name,
    call_name: defaultCallName_(name),
    level: level || '2',
    age: '',
    experience: '',
    desired_job: '',
    status: '面談前',
    memo: '',
    last_contact_at: '',
    created_at: now,
    updated_at: now
  };
  appendRecord_('candidates', rec);
  return rec;
}

/** その求職者の直近 n 件のやり取りを古い順で返す。 */
function recentHistoryFor_(candidateId, n) {
  if (!candidateId) return [];
  var rows = readAll_('history').filter(function (h) {
    return String(h.candidate_id) === String(candidateId);
  });
  rows.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : 1; });
  return rows.slice(Math.max(0, rows.length - n));
}

/** bootstrap: 起動時にまとめて返す。 */
function apiBootstrap_() {
  var history = readAll_('history');
  history.sort(function (a, b) { return String(a.created_at) > String(b.created_at) ? -1 : 1; });
  return {
    candidates: readAll_('candidates'),
    scenes: readAll_('scenes'),
    levels: readAll_('levels'),
    favorites: readAll_('favorites'),
    settings: readSettings_(),
    recentHistory: history.slice(0, 50),
    spreadsheetUrl: getSS_().getUrl()
  };
}

/**
 * generate: 文面を3案生成する。
 * 処理順: 新規名があれば登録 → 指示書組み立て → Claude → 検証/再生成 → history追記 → 3案を返す。
 */
function apiGenerate_(data) {
  var type = data.type === 'reply' ? 'reply' : 'create';
  if (!data.inputText && type === 'create') {
    throw appError_('BAD_REQUEST', '送りたい内容を入力してください');
  }
  if (type === 'reply' && !data.receivedText) {
    throw appError_('BAD_REQUEST', '届いたLINEを貼り付けてください');
  }

  var settings = readSettings_();
  var modelKey = settings.model || 'sonnet';

  // 求職者の特定 or 自動登録
  var candidate = null;
  var autoRegistered = null;
  if (data.candidateId) {
    candidate = findCandidateById_(data.candidateId);
  } else if (data.newName) {
    var existed = findCandidateByName_(data.newName);
    candidate = registerCandidate_(data.newName, data.level);
    if (!existed) autoRegistered = candidate;
  }

  var level = data.level || (candidate && candidate.level) || '2';
  var levelRow = findLevelRow_(level);
  var sceneRow = findSceneRow_(data.sceneId);
  var recent = candidate ? recentHistoryFor_(candidate.id, 5) : [];

  var systemText = buildSystemPrompt_(levelRow, sceneRow, settings);
  var userText = buildUserPrompt_({
    type: type,
    candidate: candidate || { name: data.newName || '', call_name: '' },
    recent: recent,
    inputText: data.inputText || '',
    receivedText: data.receivedText || ''
  });

  var variants = generateVariants_(systemText, userText, modelKey);

  // history に1行追加（copied_at は空）
  var historyId = nextId_('history');
  appendRecord_('history', {
    id: historyId,
    created_at: nowStr_(),
    type: type,
    candidate_id: candidate ? candidate.id : '',
    candidate_name: candidate ? candidate.name : (data.newName || ''),
    level: level,
    scene_id: data.sceneId || '',
    input_text: data.inputText || '',
    received_text: data.receivedText || '',
    variants_json: JSON.stringify(variants),
    final_text: '',
    copied_at: '',
    revise_count: '0',
    favorite: 'FALSE',
    model: modelKey
  });

  var out = { historyId: historyId, variants: variants };
  if (autoRegistered) out.candidate = autoRegistered;
  return out;
}

/**
 * revise: 選んだ案を指示に従って手直しする（1案返す）。
 */
function apiRevise_(data) {
  if (!data.historyId) throw appError_('BAD_REQUEST', '対象が指定されていません');
  if (!data.instruction) throw appError_('BAD_REQUEST', '手直しの指示を入力してください');
  if (!Array.isArray(data.currentMessages)) throw appError_('BAD_REQUEST', '手直し対象の文面がありません');

  var settings = readSettings_();
  var modelKey = settings.model || 'sonnet';

  // history 行から level / scene を引く
  var hrows = readAll_('history');
  var hrow = null;
  for (var i = 0; i < hrows.length; i++) {
    if (String(hrows[i].id) === String(data.historyId)) { hrow = hrows[i]; break; }
  }
  var levelRow = hrow ? findLevelRow_(hrow.level) : null;
  var sceneRow = hrow ? findSceneRow_(hrow.scene_id) : null;

  var systemText = buildSystemPrompt_(levelRow, sceneRow, settings);
  var userText = buildRevisePrompt_(data.currentMessages, data.instruction, levelRow, sceneRow);
  var variant = reviseVariant_(systemText, userText, modelKey);

  // revise_count を +1
  if (hrow) {
    var cnt = parseInt(hrow.revise_count || '0', 10) + 1;
    updateRecord_('history', 'id', data.historyId, { revise_count: String(cnt) });
  }
  return { variant: variant };
}

/**
 * markCopied: コピーした本文と時刻を記録。求職者の最終連絡日も更新。
 */
function apiMarkCopied_(data) {
  if (!data.historyId) throw appError_('BAD_REQUEST', '対象が指定されていません');
  var now = nowStr_();
  var updated = updateRecord_('history', 'id', data.historyId, {
    final_text: data.finalText || '',
    copied_at: now
  });
  if (updated && updated.candidate_id) {
    updateRecord_('candidates', 'id', updated.candidate_id, {
      last_contact_at: now,
      updated_at: now
    });
  }
  return {};
}

/**
 * searchHistory: 履歴を絞り込み・新しい順で20件ずつ返す。
 */
function apiSearchHistory_(data) {
  var rows = readAll_('history');
  var keyword = (data.keyword || '').trim();
  var period = data.period || 'all';
  var page = parseInt(data.page, 10);
  if (isNaN(page) || page < 0) page = 0;
  var pageSize = 20;

  // 期間しきい値
  var thresholdMs = null;
  var nowMs = Date.now();
  if (period === 'today') {
    var d = new Date(); d.setHours(0, 0, 0, 0); thresholdMs = d.getTime();
  } else if (period === '7d') {
    thresholdMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  } else if (period === '30d') {
    thresholdMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  }

  var filtered = rows.filter(function (h) {
    if (data.candidateId && String(h.candidate_id) !== String(data.candidateId)) return false;
    if (data.sceneId && String(h.scene_id) !== String(data.sceneId)) return false;
    if (data.level && String(h.level) !== String(data.level)) return false;
    if (data.favoriteOnly && String(h.favorite).toUpperCase() !== 'TRUE') return false;
    if (thresholdMs !== null) {
      var created = parseDtStr_(h.created_at);
      if (!created || created.getTime() < thresholdMs) return false;
    }
    if (keyword) {
      var hay = [h.final_text, h.input_text, h.received_text, h.candidate_name].join('\n');
      if (hay.indexOf(keyword) < 0) return false;
    }
    return true;
  });

  filtered.sort(function (a, b) { return String(a.created_at) > String(b.created_at) ? -1 : 1; });

  var startIdx = page * pageSize;
  var items = filtered.slice(startIdx, startIdx + pageSize);
  var hasMore = filtered.length > startIdx + pageSize;
  return { items: items, hasMore: hasMore };
}

/**
 * saveCandidate: 求職者を保存（id無し=新規）。
 */
function apiSaveCandidate_(data) {
  if (!data.name) throw appError_('BAD_REQUEST', '名前を入力してください');
  var now = nowStr_();
  var callName = data.call_name && data.call_name.trim() ? data.call_name : defaultCallName_(data.name);
  var level = data.level || '2';

  if (data.id) {
    var patch = {
      name: data.name,
      call_name: callName,
      level: level,
      age: data.age || '',
      experience: data.experience || '',
      desired_job: data.desired_job || '',
      status: data.status || '',
      memo: data.memo || '',
      updated_at: now
    };
    var updated = updateRecord_('candidates', 'id', data.id, patch);
    if (!updated) throw appError_('BAD_REQUEST', '対象の求職者が見つかりません');
    return { candidate: updated };
  }

  var id = nextId_('candidates');
  var rec = {
    id: id,
    name: data.name,
    call_name: callName,
    level: level,
    age: data.age || '',
    experience: data.experience || '',
    desired_job: data.desired_job || '',
    status: data.status || '面談前',
    memo: data.memo || '',
    last_contact_at: '',
    created_at: now,
    updated_at: now
  };
  appendRecord_('candidates', rec);
  return { candidate: rec };
}

/**
 * saveFavorite: お気に入り（定型文）を保存。
 * historyId 指定時は、その履歴の本文から作り、history.favorite=TRUE にする。
 */
function apiSaveFavorite_(data) {
  var now = nowStr_();
  var title = data.title || '';
  var sceneId = data.sceneId || '';
  var level = data.level || '';
  var body = data.body || '';

  if (data.historyId) {
    var hrows = readAll_('history');
    for (var i = 0; i < hrows.length; i++) {
      if (String(hrows[i].id) === String(data.historyId)) {
        var h = hrows[i];
        if (!body) {
          // final_text が無ければ1案目を使う
          body = h.final_text;
          if (!body && h.variants_json) {
            try {
              var vs = JSON.parse(h.variants_json);
              if (vs && vs[0] && vs[0].messages) body = vs[0].messages.join('\n');
            } catch (e) {}
          }
        }
        if (!sceneId) sceneId = h.scene_id;
        if (!level) level = h.level;
        if (!title) title = (h.candidate_name || '') + ' ' + (h.scene_id || '');
        break;
      }
    }
    updateRecord_('history', 'id', data.historyId, { favorite: 'TRUE' });
  }

  if (!body) throw appError_('BAD_REQUEST', '定型文の本文がありません');

  var id = nextId_('favorites');
  var rec = {
    id: id,
    title: title || '定型文',
    scene_id: sceneId,
    level: level,
    body: body,
    use_count: '0',
    created_at: now
  };
  appendRecord_('favorites', rec);
  return { favorite: rec };
}

/** deleteFavorite: お気に入り削除。 */
function apiDeleteFavorite_(data) {
  if (!data.id) throw appError_('BAD_REQUEST', '対象が指定されていません');
  deleteRecord_('favorites', 'id', data.id);
  return {};
}

/**
 * saveSettings: 設定とシーンを保存。
 * settings: key/value オブジェクト / scenes: シーン行の配列（表示・並び替え・追加）
 */
function apiSaveSettings_(data) {
  if (data.settings) {
    var allow = ['signature', 'style_rules', 'ng_words', 'model', 'session_days'];
    var patch = {};
    allow.forEach(function (k) {
      if (data.settings[k] !== undefined) patch[k] = data.settings[k];
    });
    if (Object.keys(patch).length) writeSettings_(patch);
  }

  if (Array.isArray(data.scenes)) {
    var sheet = getSheet_('scenes');
    // 全消し→書き直し（ヘッダは残す）
    var last = sheet.getLastRow();
    if (last > 1) sheet.deleteRows(2, last - 1);
    data.scenes.forEach(function (s) {
      var id = s.id || nextId_('scenes');
      appendRecord_('scenes', {
        id: id,
        phase: s.phase || '',
        name: s.name || '',
        hint: s.hint || '',
        guide: s.guide || '',
        order: s.order !== undefined ? s.order : '',
        active: s.active === false ? 'FALSE' : 'TRUE'
      });
    });
  }

  return { settings: readSettings_(), scenes: readAll_('scenes') };
}
