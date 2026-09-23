(() => {
  'use strict';

  const STORAGE_KEY = 'orbit.translation.targetLanguage';
  const CARD_ID = 'orbit-live-translation-card';
  const STATUS_ID = 'orbit-live-translation-status';
  const DONATE_BUTTON_ID = 'orbit-donate-toolbar-button';
  const DONATION_DRAWER_ID = 'orbit-donation-drawer';
  const DONATION_STATUS_ID = 'orbit-donation-status';
  const TRANSLATE_BUTTON_ID = 'orbit-translate-toolbar-button';
  const TRANSLATOR_PANEL_ID = 'orbit-translator-panel';
  const PANEL_SELECT_ID = 'orbit-panel-language-select';
  const PANEL_STATUS_ID = 'orbit-translator-panel-status';
  const START_BUTTON_ID = 'orbit-start-translation-button';
  const CARD_SELECT_ID = 'orbit-language-select';
  const DEFAULT_START_LANGUAGE = 'en';
  let currentLanguage = '';
  let translationStatus = { text: 'Translation off', state: '' };
  const transcriptRows = new Map();
  let translatorClient = null;

  // OrbitAI live translation language catalog (Google Translate full list,
  // BCP-47 codes). Dutch + Flemish (nl-BE) both map to Live Translate `nl`.
  const LANGUAGES = [
    ['ab','Abkhaz'],['ace','Acehnese'],['ach','Acholi'],['aa','Afar'],['af','Afrikaans'],
    ['sq','Albanian'],['alz','Alur'],['am','Amharic'],['ar','Arabic'],['hy','Armenian'],
    ['as','Assamese'],['av','Avar'],['awa','Awadhi'],['ay','Aymara'],['az','Azerbaijani'],
    ['ban','Balinese'],['bal','Baluchi'],['bm','Bambara'],['bci','Baoulé'],['ba','Bashkir'],
    ['eu','Basque'],['btx','Batak Karo'],['bts','Batak Simalungun'],['bbc','Batak Toba'],
    ['be','Belarusian'],['bem','Bemba'],['bn','Bengali'],['bew','Betawi'],['bho','Bhojpuri'],
    ['bik','Bikol'],['bs','Bosnian'],['br','Breton'],['bg','Bulgarian'],['bua','Buryat'],
    ['yue','Cantonese'],['ca','Catalan'],['ceb','Cebuano'],['ch','Chamorro'],['ce','Chechen'],
    ['ny','Chichewa'],['zh-Hans','Chinese (Simplified)'],['zh-Hant','Chinese (Traditional)'],
    ['chk','Chuukese'],['cv','Chuvash'],['co','Corsican'],['crh-Cyrl','Crimean Tatar (Cyrillic)'],
    ['crh-Latn','Crimean Tatar (Latin)'],['hr','Croatian'],['cs','Czech'],['da','Danish'],
    ['prs','Dari'],['dv','Dhivehi'],['din','Dinka'],['doi','Dogri'],['dov','Dombe'],
    ['nl','Dutch'],['nl-BE','Flemish (Belgian Dutch)'],['dyu','Dyula'],['dz','Dzongkha'],
    ['en','English'],['eo','Esperanto'],['et','Estonian'],['ee','Ewe'],['fo','Faroese'],
    ['fj','Fijian'],['fil','Filipino'],['fi','Finnish'],['fon','Fon'],['fr','French'],
    ['fr-CA','French (Canada)'],['fy','Frisian'],['fur','Friulian'],['ff','Fulani'],['gaa','Ga'],
    ['gl','Galician'],['ka','Georgian'],['de','German'],['el','Greek'],['gn','Guarani'],
    ['gu','Gujarati'],['ht','Haitian Creole'],['cnh','Hakha Chin'],['ha','Hausa'],['haw','Hawaiian'],
    ['he','Hebrew'],['hil','Hiligaynon'],['hi','Hindi'],['hmn','Hmong'],['hu','Hungarian'],
    ['hrx','Hunsrik'],['iba','Iban'],['is','Icelandic'],['ig','Igbo'],['ilo','Ilocano'],
    ['id','Indonesian'],['iu-Latn','Inuktut (Latin)'],['iu-Cans','Inuktut (Syllabics)'],
    ['ga','Irish'],['it','Italian'],['jam','Jamaican Patois'],['ja','Japanese'],['jv','Javanese'],
    ['kac','Jingpo'],['kl','Kalaallisut'],['kn','Kannada'],['kr','Kanuri'],['pam','Kapampangan'],
    ['kk','Kazakh'],['kha','Khasi'],['km','Khmer'],['cgg','Kiga'],['kg','Kikongo'],
    ['rw','Kinyarwanda'],['ktu','Kituba'],['trp','Kokborok'],['kv','Komi'],['gom','Konkani'],
    ['ko','Korean'],['kri','Krio'],['ku','Kurdish (Kurmanji)'],['ckb','Kurdish (Sorani)'],
    ['ky','Kyrgyz'],['lo','Lao'],['ltg','Latgalian'],['la','Latin'],['lv','Latvian'],
    ['lij','Ligurian'],['li','Limburgish'],['ln','Lingala'],['lt','Lithuanian'],['lmo','Lombard'],
    ['lg','Luganda'],['luo','Luo'],['lb','Luxembourgish'],['mk','Macedonian'],['mad','Madurese'],
    ['mai','Maithili'],['mak','Makassar'],['mg','Malagasy'],['ms','Malay'],['ms-Arab','Malay (Jawi)'],
    ['ml','Malayalam'],['mt','Maltese'],['mam','Mam'],['gv','Manx'],['mi','Maori'],
    ['mr','Marathi'],['mh','Marshallese'],['mwr','Marwadi'],['mfe','Mauritian Creole'],
    ['mhr','Meadow Mari'],['mni-Mtei','Meiteilon (Manipuri)'],['min','Minang'],['lus','Mizo'],
    ['mn','Mongolian'],['my','Myanmar (Burmese)'],['nhe','Nahuatl (Eastern Huasteca)'],
    ['ndc','Ndau'],['nr','Ndebele (South)'],['new','Nepalbhasa (Newari)'],['ne','Nepali'],
    ['nqo','NKo'],['no','Norwegian'],['nb','Norwegian Bokmål'],['nus','Nuer'],['oc','Occitan'],
    ['or','Odia (Oriya)'],['om','Oromo'],['os','Ossetian'],['pag','Pangasinan'],['pap','Papiamento'],
    ['ps','Pashto'],['fa','Persian'],['pl','Polish'],['pt-BR','Portuguese (Brazil)'],
    ['pt-PT','Portuguese (Portugal)'],['pa','Punjabi (Gurmukhi)'],['pa-Arab','Punjabi (Shahmukhi)'],
    ['qu','Quechua'],['kek','Qʼeqchiʼ'],['rom','Romani'],['ro','Romanian'],['rn','Rundi'],
    ['ru','Russian'],['se','Sami (North)'],['sm','Samoan'],['sg','Sango'],['sa','Sanskrit'],
    ['sat-Latn','Santali (Latin)'],['sat-Olck','Santali (Ol Chiki)'],['gd','Scots Gaelic'],
    ['nso','Sepedi'],['sr','Serbian'],['st','Sesotho'],['crs','Seychellois Creole'],['shn','Shan'],
    ['sn','Shona'],['scn','Sicilian'],['szl','Silesian'],['sd','Sindhi'],['si','Sinhala'],
    ['sk','Slovak'],['sl','Slovenian'],['so','Somali'],['es','Spanish'],['su','Sundanese'],
    ['sus','Susu'],['sw','Swahili'],['ss','Swati'],['sv','Swedish'],['ty','Tahitian'],
    ['tg','Tajik'],['tzm','Tamazight'],['zgh','Tamazight (Tifinagh)'],['ta','Tamil'],['tt','Tatar'],
    ['te','Telugu'],['tet','Tetum'],['th','Thai'],['bo','Tibetan'],['ti','Tigrinya'],
    ['tiv','Tiv'],['tpi','Tok Pisin'],['to','Tongan'],['lua','Tshiluba'],['ts','Tsonga'],
    ['tn','Tswana'],['tcy','Tulu'],['tum','Tumbuka'],['tr','Turkish'],['tk','Turkmen'],
    ['tyv','Tuvan'],['tw','Twi'],['udm','Udmurt'],['uk','Ukrainian'],['ur','Urdu'],
    ['ug','Uyghur'],['uz','Uzbek'],['ve','Venda'],['vec','Venetian'],['vi','Vietnamese'],
    ['war','Waray'],['cy','Welsh'],['wo','Wolof'],['xh','Xhosa'],['sah','Yakut'],
    ['yi','Yiddish'],['yo','Yoruba'],['yua','Yucatec Maya'],['zap','Zapotec'],['zu','Zulu']
  ];

  const LANGUAGE_NAME_MAP = new Map([
    ...LANGUAGES.map(([code, name]) => [code.toLowerCase(), name]),
    ['tl', 'Filipino'], ['iw', 'Hebrew'], ['jw', 'Javanese'],
    ['zh-cn', 'Chinese (Simplified)'], ['zh-tw', 'Chinese (Traditional)'], ['zh', 'Chinese (Simplified)'],
    ['crh', 'Crimean Tatar (Latin)'], ['sat', 'Santali (Latin)'],
  ]);

  function languageName(code) {
    if (typeof code !== 'string' || !code.trim()) return '';
    const key = code.trim().toLowerCase();
    if (LANGUAGE_NAME_MAP.has(key)) return LANGUAGE_NAME_MAP.get(key);
    const base = key.split(/[-_]/)[0];
    if (LANGUAGE_NAME_MAP.has(base)) return LANGUAGE_NAME_MAP.get(base);
    return code;
  }

  function autoAwesomeIcon() {
    return `<svg class="orbit-detect-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2zm7 11l.9 2.6L22.5 16.5l-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zm-14 0l.9 2.6 2.6.9-2.6.9L5 19l-.9-2.6L1.5 15.5l2.6-.9L5 12z"/></svg>`;
  }

  const DONATION_PRESETS = {
    usd: [5, 10, 25, 50],
    php: [100, 250, 500, 1000],
    eur: [5, 10, 25, 50]
  };
  const CURRENCY_SYMBOLS = { usd: '$', php: '₱', eur: '€' };

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  function getConference() {
    return window.APP?.conference?._room || window.APP?.conference?.room || null;
  }

  function currentRoomName() {
    return window.APP?.conference?.roomName || location.pathname.split('/').filter(Boolean).pop() || '';
  }

  // Jitsi chat/messages must stay exactly as upstream renders them. Never
  // mount into, restyle, or rewrite text inside chat containers.
  function isJitsiMessagesElement(el) {
    if (!el || !el.closest) return false;
    if (el.closest('[id^="orbit-"]')) return false;
    return Boolean(el.closest(
      '[data-testid*="chat" i],[data-testid*="message" i],' +
      '[class*="chat-message" i],[class*="chatMessage" i],[class*="chat_list" i],' +
      '#chat,#chat-conversation,[aria-label*="chat message" i]'
    ));
  }

  function isChatContainer(node) {
    if (!node || !node.querySelector) return false;
    if (node.id?.startsWith('orbit-')) return true;
    if (node.matches?.('[data-testid*="chat" i],[data-testid*="message" i],[id*="chat" i],[class*="chat" i]')) return true;
    return Boolean(node.querySelector('[data-testid*="chat" i],[data-testid*="message" i],[class*="chat-message" i],[class*="chatMessage" i],#chat,#chat-conversation'));
  }

  function findSidebar() {
    const selectors = [
      '[data-testid="participants-pane"]',
      '[data-testid="participants-pane-content"]',
      '.participants_pane',
      '[class*="participants-pane"]',
      '[class*="participantsPane"]',
      '#sideToolbarContainer',
      '[role="complementary"]'
    ];
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)];
      const visible = nodes.find(node => {
        if (node.id?.startsWith('orbit-')) return false;
        if (isChatContainer(node)) return false;
        const r = node.getBoundingClientRect();
        return r.width > 180 && r.height > 160;
      });
      if (visible) return visible;
    }
    const candidates = [...document.querySelectorAll('aside, [role="dialog"]')];
    return candidates.find(node => {
      if (node.id?.startsWith('orbit-')) return false;
      if (isChatContainer(node)) return false;
      const r = node.getBoundingClientRect();
      return r.width >= 240 && r.width <= 520 && r.right >= window.innerWidth - 24 && r.height > 250;
    }) || null;
  }

  function findBottomToolbar() {
    const explicit = [
      '[data-testid="toolbox-content-items"]',
      '.toolbox-content-items',
      '[class*="toolbox-content-items"]',
      '#new-toolbox [role="toolbar"]',
      '#new-toolbox'
    ];
    for (const selector of explicit) {
      const nodes = [...document.querySelectorAll(selector)];
      const match = nodes.find(node => {
        const r = node.getBoundingClientRect();
        return r.width > 180 && r.height > 30 && r.bottom > window.innerHeight * 0.72;
      });
      if (match) return match;
    }

    const toolbar = [...document.querySelectorAll('[role="toolbar"], nav, [class*="toolbox"]')]
      .filter(node => {
        const r = node.getBoundingClientRect();
        return r.width > 220 && r.height > 35 && r.bottom > window.innerHeight * 0.72 && r.top < window.innerHeight;
      })
      .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    return toolbar || null;
  }

  function setTranslationStatus(text, state = '') {
    translationStatus = { text, state };
    for (const id of [STATUS_ID, PANEL_STATUS_ID]) {
      const status = document.getElementById(id);
      if (!status || (status.dataset.text === text && status.className === state)) continue;
      status.dataset.text = text;
      status.className = state;
      status.innerHTML = `<span class="dot"></span><span>${escapeHtml(text)}</span>`;
    }
  }

  function syncTranslatorUI() {
    for (const id of [CARD_SELECT_ID, PANEL_SELECT_ID]) {
      const select = document.getElementById(id);
      if (select && [...select.options].some(o => o.value === currentLanguage)) select.value = currentLanguage;
    }
    const start = document.getElementById(START_BUTTON_ID);
    if (start) {
      start.disabled = false;
      if (currentLanguage) {
        start.textContent = 'Stop Translation';
        start.classList.add('stop');
      } else {
        start.textContent = 'Start Live Translator';
        start.classList.remove('stop');
      }
    }
    document.getElementById(TRANSLATE_BUTTON_ID)?.classList.toggle('active', Boolean(currentLanguage));
    syncLiveTranslation();
  }

  function applyLanguage(language) {
    currentLanguage = LANGUAGES.some(([code]) => code === language) ? language : '';
    try {
      if (currentLanguage) localStorage.setItem(STORAGE_KEY, currentLanguage);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    if (!currentLanguage) setTranslationStatus('Translation off');
    syncTranslatorUI();
    return true;
  }

  function onStartButtonClick() {
    const chosen = document.getElementById(PANEL_SELECT_ID)?.value || DEFAULT_START_LANGUAGE;
    applyLanguage(currentLanguage ? '' : chosen);
  }

  function syncLiveTranslation() {
    if (!translatorClient) return;
    const conference = getConference();
    if (!currentLanguage || !conference?.isJoined?.()) {
      translatorClient.stop();
      if (currentLanguage) setTranslationStatus('Join the meeting to start translation.', 'connecting');
      return;
    }
    if (translatorClient.session?.conference !== conference || translatorClient.session?.language !== currentLanguage) {
      // Use the tracks already delivered to this listener, including mixed
      // screen audio. Disable bridge playback to avoid duplicate translations.
      conference.setReceiverTranslationLanguage?.(null);
      translatorClient.start(conference, currentLanguage);
    }
  }

  function renderTranscripts() {
    for (const container of document.querySelectorAll('.orbit-transcripts')) {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
      const entries = [...transcriptRows.values()];
      container.innerHTML = entries.length ? entries.map(row => {
        const language = languageName(row.language) || row.language;
        const detected = row.sourceLanguage ? languageName(row.sourceLanguage) : '';
        const detectedHtml = detected
          ? `<div class="orbit-detected">${autoAwesomeIcon()}<span>Detect language · ${escapeHtml(detected)}</span></div>`
          : '';
        return `<article class="orbit-transcript-row">
          <div class="orbit-transcript-speaker">${escapeHtml(row.name)} · ${escapeHtml(row.kind)}</div>
          ${detectedHtml}
          <div class="orbit-transcript-label">Original transcript</div>
          <p dir="auto">${escapeHtml(row.original || 'Transcribing…')}</p>
          <div class="orbit-transcript-label">Translation · ${escapeHtml(language)}</div>
          <p class="orbit-transcript-translated" lang="${escapeHtml(row.language)}" dir="auto">${escapeHtml(row.translated || 'Translating…')}</p>
        </article>`;
      }).join('') : '<p class="orbit-transcript-empty">Original speech and its translation will appear here when audio is received.</p>';
      if (atBottom) container.scrollTop = container.scrollHeight;
    }
  }

  function receiveTranscript(row) {
    if (row.language !== currentLanguage || (!row.original && !row.translated)) return;
    const key = `${row.source}:${row.id}`;
    transcriptRows.set(key, row);
    while (transcriptRows.size > 80) transcriptRows.delete(transcriptRows.keys().next().value);
    renderTranscripts();
  }

  function transcriptMarkup() {
    return '<h3 class="orbit-transcript-heading">Live transcript</h3><div class="orbit-transcripts" role="log" aria-live="polite" aria-relevant="additions text"></div>';
  }

  function languageOptions() {
    return LANGUAGES
      .slice()
      .sort((a,b) => a[1].localeCompare(b[1]))
      .map(([code,name]) => `<option value="${escapeHtml(code)}" data-name="${escapeHtml(name.toLowerCase())}">${escapeHtml(name)}</option>`)
      .join('');
  }

  function filterLanguageSelect(select, query) {
    if (!select) return;
    const q = String(query || '').trim().toLowerCase();
    for (const option of select.options) {
      if (!option.value) { option.hidden = false; continue; }
      option.hidden = Boolean(q) && !(`${option.textContent || ''} ${option.value || ''}`.toLowerCase().includes(q));
    }
  }

  function wireLanguageSearch(searchId, selectId) {
    const search = document.getElementById(searchId);
    const select = document.getElementById(selectId);
    if (!search || !select || search.dataset.wired) return;
    search.dataset.wired = '1';
    search.addEventListener('input', () => filterLanguageSelect(select, search.value));
  }

  function createTranslationCard() {
    const card = document.createElement('section');
    card.id = CARD_ID;
    card.setAttribute('aria-label', 'OrbitAI live translation');
    card.addEventListener('pointerdown', () => { translatorClient?.resume(); resumeScreenAudio(); });

    const options = languageOptions();

    card.innerHTML = `
      <div class="orbit-title">
        <span>Live Translation</span>
        <span class="orbit-badge">ORBITAI LIVE</span>
      </div>
      <label for="${CARD_SELECT_ID}">Listen in</label>
      <input id="orbit-language-search" class="orbit-field orbit-search" type="search" placeholder="Search languages…" aria-label="Search languages" autocomplete="off" />
      <select id="${CARD_SELECT_ID}" aria-label="Translation language">
        <option value="">Off — original audio</option>
        ${options}
      </select>
      <div id="${STATUS_ID}"><span class="dot"></span><span>Translation off</span></div>
      <div class="orbit-note">Read original speech and translations in your language. Source speech is auto-detected. Shared audio is included when the presenter shares tab or system audio.</div>
      ${transcriptMarkup()}
    `;

    const select = card.querySelector(`#${CARD_SELECT_ID}`);
    const saved = localStorage.getItem(STORAGE_KEY) || '';
    if ([...select.options].some(o => o.value === saved)) select.value = saved;
    select.addEventListener('change', () => applyLanguage(select.value));
    const search = card.querySelector('#orbit-language-search');
    if (search) search.addEventListener('input', () => filterLanguageSelect(select, search.value));

    return card;
  }

  function mountTranslationCard() {
    if (document.getElementById(CARD_ID)) return;
    const sidebar = findSidebar();
    if (!sidebar) return;
    sidebar.prepend(createTranslationCard());
    syncTranslatorUI();
    setTranslationStatus(translationStatus.text, translationStatus.state);
    renderTranscripts();
  }

  function donationIcon() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20.5S4.7 16 2.4 12.2C.7 9.2 2.2 5.9 5.5 5.4c1.9-.3 3.5.7 4.5 1.9.4.5.7 1 1 1.5.3-.5.6-1 1-1.5 1-1.2 2.6-2.2 4.5-1.9 3.3.5 4.8 3.8 3.1 6.8C17.3 16 12 20.5 12 20.5z"/>
    </svg>`;
  }

  function mountDonationButton() {
    if (document.getElementById(DONATE_BUTTON_ID)) return;
    const toolbar = findBottomToolbar();
    if (!toolbar) return;

    const button = document.createElement('button');
    button.id = DONATE_BUTTON_ID;
    button.className = 'orbit-toolbar-button';
    button.type = 'button';
    button.title = 'Donate to Orbit';
    button.setAttribute('aria-label', 'Donate to Orbit');
    button.innerHTML = `${donationIcon()}<span class="orbit-toolbar-label">Donate</span>`;
    button.addEventListener('click', () => openDonationDrawer());
    toolbar.appendChild(button);
  }

  function translationIcon() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="8.5"/>
      <path d="M3.5 12h17"/>
      <path d="M12 3.5c2.4 2.5 3.7 5.4 3.7 8.5s-1.3 6-3.7 8.5c-2.4-2.5-3.7-5.4-3.7-8.5S9.6 6 12 3.5z"/>
    </svg>`;
  }

  function mountTranslateButton() {
    if (document.getElementById(TRANSLATE_BUTTON_ID)) return;
    const toolbar = findBottomToolbar();
    if (!toolbar) return;

    const button = document.createElement('button');
    button.id = TRANSLATE_BUTTON_ID;
    button.className = 'orbit-toolbar-button';
    button.type = 'button';
    button.title = 'Live Translator';
    button.setAttribute('aria-label', 'Open Live Translator');
    button.innerHTML = `${translationIcon()}<span class="orbit-toolbar-label">Translate</span>`;
    button.addEventListener('click', toggleTranslatorPanel);
    toolbar.appendChild(button);
    syncTranslatorUI();
  }

  function getTranslatorPanel() {
    let panel = document.getElementById(TRANSLATOR_PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('aside');
    panel.id = TRANSLATOR_PANEL_ID;
    panel.setAttribute('aria-label', 'OrbitAI Live Translator');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
      <div class="orbit-donation-header">
        <div>
          <div class="orbit-donation-eyebrow">ORBITAI LIVE</div>
          <h2>Live Translator</h2>
        </div>
        <button class="orbit-donation-close" type="button" aria-label="Close live translator">×</button>
      </div>
      <div class="orbit-donation-body">
        <p class="orbit-donation-copy">Translate meeting speech and shared audio into your language, with the original transcript alongside each translation.</p>
        <div class="orbit-detect-note">${autoAwesomeIcon()}<span>Detect language is automatic — source speech is identified per segment.</span></div>

        <label class="orbit-field-label" for="${PANEL_SELECT_ID}">Listen in</label>
        <input id="orbit-panel-language-search" class="orbit-field orbit-search" type="search" placeholder="Search languages…" aria-label="Search languages" autocomplete="off" />
        <select id="${PANEL_SELECT_ID}" class="orbit-field" aria-label="Translation language">
          <option value="">Off — original audio</option>
          ${languageOptions()}
        </select>

        <button id="${START_BUTTON_ID}" class="orbit-start-button" type="button">Start Live Translator</button>
        <div id="${PANEL_STATUS_ID}"><span class="dot"></span><span>Translation off</span></div>
        <div id="${SCREEN_CAPTION_ID}" aria-live="polite"></div>
        ${transcriptMarkup()}
        <div class="orbit-stripe-note">Your language choice only affects your translation. Dutch and Flemish (Belgian Dutch) both use Live Dutch voice. Your own mic stays text-only, but shared screen audio TTS is always played. For shared content, the presenter must enable Share tab audio or Share system audio.</div>
      </div>
    `;

    document.body.appendChild(panel);
    panel.querySelector('.orbit-donation-close').addEventListener('click', closeTranslatorPanel);
    panel.addEventListener('pointerdown', () => { translatorClient?.resume(); resumeScreenAudio(); });
    const select = panel.querySelector(`#${PANEL_SELECT_ID}`);
    const saved = localStorage.getItem(STORAGE_KEY) || '';
    if ([...select.options].some(o => o.value === saved)) select.value = saved;
    select.addEventListener('change', () => applyLanguage(select.value));
    const search = panel.querySelector('#orbit-panel-language-search');
    if (search) search.addEventListener('input', () => filterLanguageSelect(select, search.value));
    panel.querySelector(`#${START_BUTTON_ID}`).addEventListener('click', onStartButtonClick);
    syncTranslatorUI();
    renderTranscripts();
    return panel;
  }

  function openTranslatorPanel() {
    translatorClient?.resume();
    resumeScreenAudio();
    closeDonationDrawer();
    const panel = getTranslatorPanel();
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.getElementById(TRANSLATE_BUTTON_ID)?.classList.toggle('active', Boolean(currentLanguage));
  }

  function closeTranslatorPanel() {
    const panel = document.getElementById(TRANSLATOR_PANEL_ID);
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.getElementById(TRANSLATE_BUTTON_ID)?.classList.toggle('active', Boolean(currentLanguage));
  }

  function toggleTranslatorPanel() {
    const panel = getTranslatorPanel();
    if (panel.classList.contains('open')) closeTranslatorPanel();
    else openTranslatorPanel();
  }

  function getDonationDrawer() {
    let drawer = document.getElementById(DONATION_DRAWER_ID);
    if (drawer) return drawer;

    drawer = document.createElement('aside');
    drawer.id = DONATION_DRAWER_ID;
    drawer.setAttribute('aria-label', 'Orbit Donation Gateway');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = `
      <div class="orbit-donation-header">
        <div>
          <div class="orbit-donation-eyebrow">ORBIT</div>
          <h2>Support Orbit</h2>
        </div>
        <button class="orbit-donation-close" type="button" aria-label="Close donation panel">×</button>
      </div>
      <div class="orbit-donation-body">
        <p class="orbit-donation-copy">Your donation helps keep Orbit live communication and OrbitAI translation available.</p>

        <label class="orbit-field-label" for="orbit-donation-currency">Currency</label>
        <select id="orbit-donation-currency" class="orbit-field">
          <option value="usd">USD — US Dollar</option>
          <option value="php">PHP — Philippine Peso</option>
          <option value="eur">EUR — Euro</option>
        </select>

        <div class="orbit-field-label">Choose an amount</div>
        <div id="orbit-donation-presets" class="orbit-donation-presets"></div>

        <label class="orbit-field-label" for="orbit-donation-custom">Custom amount</label>
        <div class="orbit-money-field">
          <span id="orbit-currency-symbol">$</span>
          <input id="orbit-donation-custom" class="orbit-field" type="number" inputmode="decimal" min="1" step="0.01" placeholder="10.00" />
        </div>

        <label class="orbit-field-label" for="orbit-donor-name">Name <span>optional</span></label>
        <input id="orbit-donor-name" class="orbit-field" type="text" maxlength="100" autocomplete="name" placeholder="Anonymous" />

        <label class="orbit-field-label" for="orbit-donor-email">Email <span>optional</span></label>
        <input id="orbit-donor-email" class="orbit-field" type="email" maxlength="320" autocomplete="email" placeholder="you@example.com" />

        <button id="orbit-donate-submit" class="orbit-donate-submit" type="button">Continue to secure donation</button>
        <div id="${DONATION_STATUS_ID}" class="orbit-donation-status" aria-live="polite"></div>
        <div class="orbit-stripe-note">Payment is completed on Stripe's secure Checkout page. Orbit never receives your card details.</div>
      </div>
    `;

    document.body.appendChild(drawer);
    drawer.querySelector('.orbit-donation-close').addEventListener('click', closeDonationDrawer);
    drawer.querySelector('#orbit-donation-currency').addEventListener('change', updateDonationPresets);
    drawer.querySelector('#orbit-donate-submit').addEventListener('click', startDonationCheckout);
    updateDonationPresets();
    return drawer;
  }

  function setDonationStatus(text, state = '') {
    const el = document.getElementById(DONATION_STATUS_ID);
    if (!el) return;
    el.className = `orbit-donation-status ${state}`.trim();
    el.textContent = text || '';
  }

  function openDonationDrawer() {
    closeTranslatorPanel();
    const drawer = getDonationDrawer();
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.getElementById(DONATE_BUTTON_ID)?.classList.add('active');
    setTimeout(() => drawer.querySelector('.orbit-donation-close')?.focus(), 50);
  }

  function closeDonationDrawer() {
    const drawer = document.getElementById(DONATION_DRAWER_ID);
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.getElementById(DONATE_BUTTON_ID)?.classList.remove('active');
  }

  function updateDonationPresets() {
    const currency = document.getElementById('orbit-donation-currency')?.value || 'usd';
    const wrapper = document.getElementById('orbit-donation-presets');
    const symbol = CURRENCY_SYMBOLS[currency] || '';
    const symbolNode = document.getElementById('orbit-currency-symbol');
    if (symbolNode) symbolNode.textContent = symbol;
    if (!wrapper) return;
    wrapper.innerHTML = '';
    for (const amount of DONATION_PRESETS[currency] || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'orbit-preset';
      button.textContent = `${symbol}${amount}`;
      button.dataset.amount = String(amount);
      button.addEventListener('click', () => {
        wrapper.querySelectorAll('.orbit-preset').forEach(b => b.classList.remove('selected'));
        button.classList.add('selected');
        const custom = document.getElementById('orbit-donation-custom');
        if (custom) custom.value = String(amount);
      });
      wrapper.appendChild(button);
    }
  }

  async function startDonationCheckout() {
    const submit = document.getElementById('orbit-donate-submit');
    const currency = document.getElementById('orbit-donation-currency')?.value || 'usd';
    const amount = Number(document.getElementById('orbit-donation-custom')?.value || 0);
    const name = document.getElementById('orbit-donor-name')?.value || '';
    const email = document.getElementById('orbit-donor-email')?.value || '';

    if (!Number.isFinite(amount) || amount < 1) {
      setDonationStatus('Choose a donation amount of at least 1.00.', 'error');
      return;
    }
    const amountMinor = Math.round(amount * 100);
    if (amountMinor > 100000000) {
      setDonationStatus('That amount is above the supported checkout limit.', 'error');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Opening secure checkout…';
    setDonationStatus('Creating your secure Stripe Checkout session…', 'working');

    try {
      const response = await fetch('/api/donations/create-checkout-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amountMinor,
          currency,
          name,
          email,
          room: currentRoomName(),
          returnPath: `${location.pathname}${location.search}${location.hash}`
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || `Checkout request failed (${response.status})`);
      location.assign(data.url);
    } catch (error) {
      console.error('[Orbit Donations] Stripe Checkout error', error);
      setDonationStatus(error.message || 'Unable to open donation checkout.', 'error');
      submit.disabled = false;
      submit.textContent = 'Continue to secure donation';
    }
  }

  async function handleDonationReturn() {
    const params = new URLSearchParams(location.search);
    const state = params.get('orbitDonation');
    if (!state) return;
    openDonationDrawer();

    if (state === 'cancelled') {
      setDonationStatus('Donation checkout was cancelled. No payment was made.', 'neutral');
      return;
    }
    const sessionId = params.get('session_id');
    if (state === 'success' && sessionId) {
      setDonationStatus('Verifying your donation…', 'working');
      try {
        const response = await fetch(`/api/donations/session?session_id=${encodeURIComponent(sessionId)}`);
        const data = await response.json();
        if (response.ok && data.paymentStatus === 'paid') {
          const amount = typeof data.amountTotal === 'number' ? (data.amountTotal / 100).toFixed(2) : '';
          setDonationStatus(`Thank you! Your ${String(data.currency || '').toUpperCase()} ${amount} donation was received.`, 'success');
        } else {
          setDonationStatus('Checkout completed. Payment confirmation is still processing.', 'working');
        }
      } catch (error) {
        console.error('[Orbit Donations] Could not verify donation return', error);
        setDonationStatus('Checkout completed. Payment confirmation is still processing.', 'working');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Screen-share audio translation (TTS).
  //
  // The bridge only exports each sender's first (mic) audio source, so
  // desktop audio never reaches the server-side bridge path. This parallel
  // path covers it: the SHARER's browser captures its desktop-audio track
  // and publishes 16 kHz PCM to the OrbitAI screen hub (/api/screen/);
  // LISTENERS with an active translation language subscribe and hear it
  // translated (TTS), with the original screen audio ducked and live
  // captions in the translator panel. Never touches Jitsi chat/messages.
  // -------------------------------------------------------------------------
  const SCREEN_CAPTION_ID = 'orbit-screen-caption';
  let screenPublisher = null;
  let screenSubscriber = null;
  let screenCaptionTimer = 0;

  function screenWsUrl(room) {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}/api/screen/${encodeURIComponent(room || 'lobby')}`;
  }

  function floatToS16Bytes(floats) {
    const out = new Uint8Array(floats.length * 2);
    for (let i = 0; i < floats.length; i++) {
      const v = Math.max(-1, Math.min(1, floats[i]));
      const s = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7FFF);
      out[i * 2] = s & 0xFF;
      out[i * 2 + 1] = (s >> 8) & 0xFF;
    }
    return out;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function localDesktopAudioTrack() {
    try {
      const conf = window.APP?.conference;
      const room = conf?._room || conf?.room;
      const list = room?.getLocalTracks?.('audio') || room?.getLocalTracks?.() || conf?.getLocalTracks?.('audio') || [];
      return (list || []).find(t => {
        const vt = t.videoType || (typeof t.getVideoType === 'function' && t.getVideoType());
        if (vt !== 'desktop') return false;
        if (typeof t.isAudioTrack === 'function' && !t.isAudioTrack()) return false;
        return true;
      }) || null;
    } catch {
      return null;
    }
  }

  const SCREEN_WORKLET = `
    registerProcessor('orbit-down16k', class extends AudioWorkletProcessor {
      process(inputs) {
        const ch = inputs && inputs[0] && inputs[0][0];
        if (ch && ch.length) {
          const out = new Float32Array(Math.floor(ch.length / 3));
          for (let i = 0, j = 0; j < out.length; i += 3, j++) {
            out[j] = (ch[i] + ch[i + 1] + ch[i + 2]) / 3;
          }
          this.port.postMessage(out, [out.buffer]);
        }
        return true;
      }
    });
  `;

  async function startScreenPublisher(track, room) {
    stopScreenPublisher();
    const mediaTrack = track?.getTrack?.() || track?.track;
    if (!mediaTrack || mediaTrack.readyState === 'ended') return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx || !window.AudioWorkletNode) return;
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
      const ws = new WebSocket(screenWsUrl(room));
      const entry = { ws, ctx: null, nodes: [], track: mediaTrack, room };
      screenPublisher = entry;
      ws.onopen = () => {
        if (screenPublisher !== entry) { try { ws.close(); } catch {} return; }
        try { ws.send(JSON.stringify({ event: 'screen-join', role: 'publisher', meeting: room })); } catch {}
      };
      ws.onclose = () => { if (screenPublisher === entry) screenPublisher = null; };
      ws.onerror = () => { try { ws.close(); } catch {} };
      const ctx = new Ctx({ sampleRate: 48000 });
      entry.ctx = ctx;
      try { await ctx.resume?.(); } catch {}
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([SCREEN_WORKLET], { type: 'application/javascript' })));
      if (screenPublisher !== entry) return;
      const src = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
      const node = new AudioWorkletNode(ctx, 'orbit-down16k');
      entry.nodes = [src, node];
      let pending = [];
      let pendingSamples = 0;
      node.port.onmessage = (event) => {
        if (screenPublisher !== entry || ws.readyState !== WebSocket.OPEN) return;
        pending.push(event.data);
        pendingSamples += event.data.length;
        while (pendingSamples >= 1600) {
          const frame = new Float32Array(1600);
          let filled = 0;
          while (filled < 1600 && pending.length) {
            const head = pending[0];
            const take = Math.min(head.length, 1600 - filled);
            frame.set(head.subarray(0, take), filled);
            filled += take;
            pending[0] = head.subarray(take);
            if (!pending[0].length) pending.shift();
          }
          pendingSamples -= 1600;
          try { ws.send(JSON.stringify({ event: 'screen-pcm', pcm16: bytesToBase64(floatToS16Bytes(frame)) })); } catch {}
        }
      };
      src.connect(node);
      const onEnded = () => stopScreenPublisher();
      try { mediaTrack.addEventListener?.('ended', onEnded, { once: true }); } catch {}
      entry.onEnded = onEnded;
    } catch (error) {
      console.error('[OrbitAI] Screen publisher failed', error);
      stopScreenPublisher();
    }
  }

  function stopScreenPublisher() {
    const entry = screenPublisher;
    screenPublisher = null;
    if (!entry) return;
    try { entry.track?.removeEventListener?.('ended', entry.onEnded); } catch {}
    try { entry.nodes.forEach(n => { try { n.disconnect(); } catch {} }); } catch {}
    try { entry.ctx?.close?.(); } catch {}
    try { entry.ws?.close?.(1000, 'publisher stopped'); } catch {}
  }

  function manageScreenPublisher() {
    const track = localDesktopAudioTrack();
    const room = currentRoomName();
    if (track && track.getTrack?.()?.readyState !== 'ended') {
      const mediaId = track.getTrack?.()?.id;
      if (!screenPublisher || screenPublisher.track?.id !== mediaId || screenPublisher.room !== room) {
        startScreenPublisher(track, room);
      }
    } else if (screenPublisher) {
      stopScreenPublisher();
    }
  }

  function findScreenAudioElements() {
    const ids = new Set();
    try {
      const conf = window.APP?.conference;
      const room = conf?._room || conf?.room;
      const parts = room?.getParticipants?.() || conf?.getParticipants?.() || [];
      for (const p of parts) {
        for (const t of (p.getTracksByMediaType?.('audio') || p.getTracks?.() || [])) {
          const vt = t.videoType || (typeof t.getVideoType === 'function' && t.getVideoType());
          if (vt !== 'desktop') continue;
          const mt = t.getTrack?.();
          if (mt?.id) ids.add(mt.id);
        }
      }
    } catch {}
    if (!ids.size) return [];
    return [...document.querySelectorAll('audio')].filter(el => {
      try {
        return (el.srcObject?.getAudioTracks?.() || []).some(t => ids.has(t.id));
      } catch { return false; }
    });
  }

  function duckOriginalScreenAudio(active) {
    for (const el of findScreenAudioElements()) {
      try {
        if (active) {
          if (el.dataset.orbitScreenVol === undefined) el.dataset.orbitScreenVol = String(el.volume);
          el.volume = 0.05;
        } else if (el.dataset.orbitScreenVol !== undefined) {
          el.volume = Number(el.dataset.orbitScreenVol);
          delete el.dataset.orbitScreenVol;
        }
      } catch {}
    }
  }

  function showScreenCaption(text) {
    const el = document.getElementById(SCREEN_CAPTION_ID);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('has-text', Boolean(text));
    if (screenCaptionTimer) clearTimeout(screenCaptionTimer);
    if (text) screenCaptionTimer = setTimeout(() => { el.textContent = ''; el.classList.remove('has-text'); }, 8000);
  }

  function resumeScreenAudio() {
    try { screenSubscriber?.ctx?.resume?.()?.catch?.(() => {}); } catch {}
  }

  function startScreenSubscriber(language, room) {
    stopScreenSubscriber();
    if (!LANGUAGES.some(([code]) => code === language)) return;
    const entry = { ws: null, ctx: null, nextTime: 0, language, room };
    screenSubscriber = entry;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx({ sampleRate: 48000 });
      entry.ctx = ctx;
      try { ctx.resume?.()?.catch?.(() => {}); } catch {}
      const ws = new WebSocket(screenWsUrl(room));
      entry.ws = ws;
      ws.onopen = () => {
        if (screenSubscriber !== entry) { try { ws.close(); } catch {} return; }
        try { ws.send(JSON.stringify({ event: 'screen-join', role: 'subscriber', meeting: room, language })); } catch {}
      };
      ws.onmessage = (event) => {
        if (screenSubscriber !== entry) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.event === 'screen-audio' && msg.pcm48) {
          playScreenChunk(entry, msg.pcm48);
        } else if (msg.event === 'screen-talk') {
          duckOriginalScreenAudio(Boolean(msg.active));
          if (!msg.active) setTimeout(() => duckOriginalScreenAudio(false), 1200);
        } else if (msg.event === 'screen-transcript' && msg.text) {
          showScreenCaption(msg.text);
        }
      };
      ws.onclose = () => { if (screenSubscriber === entry) { duckOriginalScreenAudio(false); screenSubscriber = null; } };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch (error) {
      console.error('[OrbitAI] Screen subscriber failed', error);
      stopScreenSubscriber();
    }
  }

  function playScreenChunk(entry, pcm48b64) {
    try {
      const bytes = base64ToBytes(pcm48b64);
      const samples = bytes.length / 2;
      if (!samples) return;
      const ctx = entry.ctx;
      if (!ctx || ctx.state === 'closed') return;
      if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch {} }
      const buffer = ctx.createBuffer(1, samples, 48000);
      const data = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < samples; i++) data[i] = view.getInt16(i * 2, true) / 0x8000;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const now = ctx.currentTime;
      if (entry.nextTime < now) entry.nextTime = now + 0.05;
      // Drop ancient backlog after stalls so speech stays live, not delayed.
      if (entry.nextTime > now + 3) entry.nextTime = now + 0.05;
      try { src.start(entry.nextTime); } catch { return; }
      entry.nextTime += samples / 48000;
    } catch (error) {
      console.error('[OrbitAI] Screen playback failed', error);
    }
  }

  function stopScreenSubscriber() {
    const entry = screenSubscriber;
    screenSubscriber = null;
    if (!entry) return;
    duckOriginalScreenAudio(false);
    try { entry.ws?.close?.(1000, 'subscriber stopped'); } catch {}
    try { entry.ctx?.close?.(); } catch {}
  }

  // Keep the screen subscription glued to the translation state: subscribed
  // exactly while a target language is active, in the current room.
  function syncScreenSubscriber() {
    const room = currentRoomName();
    if (currentLanguage) {
      if (!screenSubscriber || screenSubscriber.language !== currentLanguage || screenSubscriber.room !== room) {
        startScreenSubscriber(currentLanguage, room);
      } else if (screenSubscriber.ws?.readyState === WebSocket.CLOSED) {
        startScreenSubscriber(currentLanguage, room);
      }
    } else if (screenSubscriber) {
      stopScreenSubscriber();
      showScreenCaption('');
    }
  }

  function applyOrbitBranding() {
    if (document.title.includes('Jitsi')) document.title = document.title.replaceAll('Jitsi Meet', 'Orbit').replaceAll('Jitsi', 'Orbit');
    document.querySelectorAll('img[alt*="Jitsi"], img[aria-label*="Jitsi"]').forEach(img => {
      img.alt = 'Orbit';
      img.setAttribute('aria-label', 'Orbit');
    });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (parent?.closest('script,style,textarea,input,.orbit-transcripts,[id^="orbit-"]')) continue;
      // Keep the Jitsi messages/chat UI byte-for-byte original.
      if (parent && isJitsiMessagesElement(parent)) continue;
      if (/\bJitsi(?: Meet)?\b/.test(node.nodeValue || '')) nodes.push(node);
    }
    for (const node of nodes.slice(0, 80)) {
      node.nodeValue = node.nodeValue.replaceAll('Jitsi Meet', 'Orbit').replaceAll('Jitsi', 'Orbit');
    }
  }

  function mount() {
    mountTranslationCard();
    mountTranslateButton();
    mountDonationButton();
    manageScreenPublisher();
    syncScreenSubscriber();
    syncLiveTranslation();
    applyOrbitBranding();
  }

  let mountFrame = 0;
  const observer = new MutationObserver(records => {
    // The extension mutates its own status and transcript. Do not recursively
    // remount in response to those changes or classList updates. Jitsi
    // chat/messages are also left alone — they never trigger a remount.
    const relevant = records.filter(record => {
      const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!el) return false;
      if (el.closest?.('[id^="orbit-"]')) return false;
      if (isJitsiMessagesElement(el)) return false;
      return true;
    });
    if (!relevant.length) return;
    if (!mountFrame) mountFrame = requestAnimationFrame(() => { mountFrame = 0; mount(); });
  });
  const start = () => {
    document.title = 'Orbit';
    try { currentLanguage = localStorage.getItem(STORAGE_KEY) || ''; } catch {}
    if (!LANGUAGES.some(([code]) => code === currentLanguage)) currentLanguage = '';
    translatorClient = new window.OrbitTranslatorClient({
      onStatus: setTranslationStatus, onTranscript: receiveTranscript,
      onReset: () => { transcriptRows.clear(); renderTranscripts(); }
    });
    window.addEventListener('pagehide', () => { try { translatorClient.stop(); } catch {} stopScreenPublisher(); stopScreenSubscriber(); });
    getDonationDrawer();
    getTranslatorPanel();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style'] });
    mount();
    handleDonationReturn();
    setInterval(mount, 2000);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { closeDonationDrawer(); closeTranslatorPanel(); }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
