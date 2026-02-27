// ============================
// Helpers
// ============================

function scrollToBottom(smooth){
  const container = document.querySelector('.messages-container');
  if(smooth) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  else container.scrollTop = container.scrollHeight;
}

function autoResize(){
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
}

function updateChatTitle(chat, content){
  if(chat.title === 'New Chat'){
    chat.title = content.slice(0, 40);
    topbarTitle.textContent = chat.title;
  }
}

function updateModelLabel(){
  modelLabel.textContent = `${state.provider} • ${state.model}`;
}

// ============================
// ---- Markdown parser (safe for code blocks) ----
function markdownToHtml(text) {
  let html = escapeHtml(text);

  // Store code blocks and inline code in placeholders
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `%%CODEBLOCK${codeBlocks.length}%%`;
    codeBlocks.push(`<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`);
    return placeholder;
  });

  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `%%INLINECODE${codeBlocks.length}%%`;
    codeBlocks.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // Apply formatting to everything else
  html = html
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Unordered lists
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<(?:pre|h[1-6]|ul|ol|blockquote|hr))/g, '$1');
  html = html.replace(/(<\/(?:pre|h[1-6]|ul|ol|blockquote)>)<\/p>/g, '$1');

  // Restore code blocks and inline code
  codeBlocks.forEach((codeHtml, index) => {
    html = html.replace(`%%CODEBLOCK${index}%%`, codeHtml);
    html = html.replace(`%%INLINECODE${index}%%`, codeHtml);
  });

  return html;
}

// ---- HTML escape helper ----
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ============================
// Providers
// ============================

const PROVIDERS = {
  anthropic: { name: 'Anthropic', endpoint: 'https://api.anthropic.com/v1/messages' },
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions' },
  cerebras: { name: 'Cerebras', endpoint: 'https://api.cerebras.ai/v1/chat/completions' }
};
const FALLBACK_ENDPOINT = 'https://keycap-ai.onrender.com/generate';

// ============================
// State
// ============================

let state = {
  apiKey: localStorage.getItem('nc_apikey') || '',
  provider: localStorage.getItem('nc_provider') || 'anthropic',
  model: localStorage.getItem('nc_model') || 'claude-sonnet-4-6',
  systemPrompt: localStorage.getItem('nc_systemprompt') || '',
  triggers: JSON.parse(localStorage.getItem('nc_triggers') || '[]'),
  chats: JSON.parse(localStorage.getItem('nc_chats') || '[]'),
  activeChatId: null,
  streaming: false,
};

// ============================
// DOM
// ============================

const $ = id => document.getElementById(id);
const messagesEl = $('messages');
const welcomeEl = $('welcomeScreen');
const inputEl = $('userInput');
const sendBtn = $('sendBtn');
const chatListEl = $('chatList');
const topbarTitle = $('topbarTitle');
const modelLabel = $('modelLabel');
const modelDropdown = $('modelDropdown');
const modelSelector = $('modelSelector');
const sidebar = $('sidebar');
const sidebarToggle = $('sidebarToggle');

// Settings Modal
const settingsModal = $('settingsModal');
const openSettingsBtn = $('openSettingsBtn');
const closeSettingsBtn = $('closeSettings');
const saveSettingsBtn = $('saveSettingsBtn');
const apiKeyInput = $('apiKeyInput');
const providerSelect = $('providerSelect');
const modelSelect = $('modelSelect');
const systemPromptInput = $('systemPromptInput');
const triggerListEl = $('triggerList');
const addTriggerBtn = $('addTriggerBtn');

// ============================
// Init
// ============================

function init() {
  renderChatList();
  if (state.chats.length > 0) loadChat(state.chats[0].id);
  setupEventListeners();
  updateModelLabel();
  if (!state.apiKey) promptForKey();
}

function promptForKey() {
  const key = window.prompt('Enter API Key:', '');
  if (key && key.trim()) {
    state.apiKey = key.trim();
    localStorage.setItem('nc_apikey', state.apiKey);
  }
}

// ============================
// Chat Management
// ============================

function createChat() {
  const chat = { id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: Date.now() };
  state.chats.unshift(chat);
  saveChats();
  renderChatList();
  loadChat(chat.id);
}

function loadChat(id) {
  state.activeChatId = id;
  const chat = getChat(id);
  if (!chat) return;
  topbarTitle.textContent = chat.title;
  messagesEl.innerHTML = '';
  if (chat.messages.length === 0) {
    welcomeEl.style.display = 'flex';
    messagesEl.style.display = 'none';
  } else {
    welcomeEl.style.display = 'none';
    messagesEl.style.display = 'flex';
    chat.messages.forEach(msg => renderMessage(msg.role, msg.content));
    attachRunButtons();
  }
  renderChatList();
  scrollToBottom(true);
}

function getChat(id) { return state.chats.find(c => c.id === id); }
function getActiveChat() { return getChat(state.activeChatId); }

function deleteChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  saveChats();
  if (state.activeChatId === id) {
    if (state.chats.length > 0) loadChat(state.chats[0].id);
    else { state.activeChatId = null; messagesEl.innerHTML = ''; welcomeEl.style.display = 'flex'; topbarTitle.textContent = 'New Conversation'; }
  }
  renderChatList();
}

function saveChats() { localStorage.setItem('nc_chats', JSON.stringify(state.chats)); }

function renderChatList() {
  chatListEl.innerHTML = '';
  if (state.chats.length === 0) { chatListEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-muted);">No chats yet</div>'; return; }
  state.chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === state.activeChatId ? ' active' : '');
    item.dataset.id = chat.id;
    const title = document.createElement('span');
    title.className = 'chat-item-title'; title.textContent = chat.title;
    const del = document.createElement('button'); del.className = 'chat-item-del'; del.innerHTML = '×'; del.onclick = e => { e.stopPropagation(); deleteChat(chat.id); };
    item.appendChild(title); item.appendChild(del); item.onclick = () => loadChat(chat.id);
    chatListEl.appendChild(item);
  });
}

// ============================
// Messaging
// ============================

async function sendMessage(content) {
  if (!content.trim() || state.streaming) return;
  if (!state.apiKey) return promptForKey();

  if (!state.activeChatId) createChat();
  const chat = getActiveChat(); if (!chat) return;

  welcomeEl.style.display = 'none'; messagesEl.style.display = 'flex';

  chat.messages.push({ role: 'user', content }); await renderMessageAsync('user', content); updateChatTitle(chat, content); saveChats();
  inputEl.value = ''; autoResize(); sendBtn.disabled = true;
  const typingEl = showTyping(); state.streaming = true;

  try {
    const assistantText = await callProvider(chat.messages); typingEl.remove();
    chat.messages.push({ role: 'assistant', content: assistantText }); saveChats();
    await renderMessageAsync('assistant', assistantText);
  } catch (err) {
    typingEl.remove(); renderError(err.message || 'All providers failed.');
  } finally {
    state.streaming = false;
    sendBtn.disabled = !inputEl.value.trim();
  }
}

// ============================
// Provider Calls
// ============================

async function callProvider(messages) {
  const provider = PROVIDERS[state.provider]; if (!provider) throw new Error("Invalid provider");

  // Build body — Anthropic uses top-level "system", OpenAI/Cerebras use messages array
  let body;
  if (state.provider === 'anthropic') {
    body = { model: state.model, messages, max_tokens: 4096, temperature: 0.7 };
    if (state.systemPrompt) body.system = state.systemPrompt;
  } else {
    const msgs = state.systemPrompt
      ? [{ role: 'system', content: state.systemPrompt }, ...messages]
      : messages;
    body = { model: state.model, messages: msgs, temperature: 0.7 };
  }

  const res = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Provider error: ${res.status}`);
  }
  const data = await res.json();

  // Anthropic returns content array, others return choices
  if (state.provider === 'anthropic') {
    return data.content?.[0]?.text || "(no response)";
  }
  return data.choices?.[0]?.message?.content || "(no response)";
}

// ============================
// Rendering
// ============================

function renderMessage(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  if(role === 'assistant') {
    msg.innerHTML = `<div class="message-row"><div class="avatar assistant">✦</div><div class="bubble">${markdownToHtml(content)}</div></div>`;
  } else {
    msg.innerHTML = `<div class="message-row"><div class="avatar user">U</div><div class="bubble">${escapeHtml(content)}</div></div>`;
  }
  messagesEl.appendChild(msg);
  scrollToBottom(true);
}

function showTyping() {
  const msg = document.createElement('div'); msg.className = 'message assistant';
  msg.innerHTML = `<div class="message-row"><div class="avatar assistant">✦</div><div class="bubble">Typing...</div></div>`;
  messagesEl.appendChild(msg); scrollToBottom(true); return msg;
}

function renderError(text) {
  const msg = document.createElement('div'); msg.className = 'message assistant';
  msg.innerHTML = `<div class="message-row"><div class="avatar assistant" style="color:red;">!</div><div class="bubble" style="color:red;">${escapeHtml(text)}</div></div>`;
  messagesEl.appendChild(msg);
}

// ============================
// Trigger Engine
// ============================

function checkTriggers(text) {
  state.triggers.forEach((trigger, idx) => {
    if (!trigger.match || !trigger.action) return;
    let matched = false;
    let matchResult = null;
    try {
      if (trigger.type === 'regex') {
        const re = new RegExp(trigger.match, 'i');
        matchResult = text.match(re);
        matched = !!matchResult;
      } else {
        matched = text.toLowerCase().includes(trigger.match.toLowerCase());
        matchResult = matched ? [trigger.match] : null;
      }
    } catch(e) {
      showToast(`Trigger #${idx+1} match error: ${e.message}`, 'error');
      return;
    }

    if (!matched) return;

    // Action is always raw JS. Available vars: response (full text), match (regex match array or [matchStr])
    try {
      // eslint-disable-next-line no-new-func
      new Function('response', 'match', trigger.action)(text, matchResult);
      showToast(`Trigger fired: "${trigger.match}"`);
    } catch(e) {
      showToast(`Trigger #${idx+1} JS error: ${e.message}`, 'error');
    }
  });
}

function showToast(msg, type) {
  const toast = document.createElement('div');
  toast.className = 'trigger-toast' + (type === 'error' ? ' trigger-toast-error' : '');
  const icon = type === 'error' ? '⚠️' : '⚡';
  toast.innerHTML = `<span class="trigger-toast-icon">${icon}</span><span>${escapeHtml(msg)}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ============================
// JS Code Runner
// ============================

function attachRunButtons() {
  // Find all <pre><code class="language-js*"> or "language-javascript" blocks
  messagesEl.querySelectorAll('pre code[class*="language-j"]').forEach(codeEl => {
    const pre = codeEl.parentElement;
    if (pre.querySelector('.run-js-btn')) return; // already attached

    const lang = codeEl.className || '';
    if (!lang.match(/language-j(s|avascript)?$/i)) return;

    const btn = document.createElement('button');
    btn.className = 'run-js-btn';
    btn.textContent = '▶ Run';
    pre.style.position = 'relative';
    pre.appendChild(btn);

    btn.addEventListener('click', () => {
      // Remove existing output
      const existing = pre.nextElementSibling;
      if (existing && existing.classList.contains('js-output')) existing.remove();

      const code = codeEl.textContent;
      const outputEl = document.createElement('div');

      // Capture console.log output
      const logs = [];
      const origLog = console.log;
      const origWarn = console.warn;
      const origError = console.error;
      console.log = (...a) => { logs.push(a.map(String).join(' ')); origLog(...a); };
      console.warn = (...a) => { logs.push('[warn] ' + a.map(String).join(' ')); origWarn(...a); };
      console.error = (...a) => { logs.push('[error] ' + a.map(String).join(' ')); origError(...a); };

      try {
        // eslint-disable-next-line no-new-func
        const result = new Function(code)();
        console.log = origLog; console.warn = origWarn; console.error = origError;
        const output = [...logs, result !== undefined ? `→ ${String(result)}` : ''].filter(Boolean).join('\n') || '(no output)';
        outputEl.className = 'js-output success';
        outputEl.textContent = output;
      } catch(e) {
        console.log = origLog; console.warn = origWarn; console.error = origError;
        outputEl.className = 'js-output error';
        outputEl.textContent = `Error: ${e.message}`;
      }

      pre.insertAdjacentElement('afterend', outputEl);
    });
  });
}

// ============================
// Async character-by-character rendering
// ============================

async function renderMessageAsync(role, content) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  if (role === 'assistant') {
    const row = document.createElement('div');
    row.className = 'message-row';
    const avatar = document.createElement('div');
    avatar.className = 'avatar assistant';
    avatar.textContent = '✦';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    row.appendChild(avatar);
    row.appendChild(bubble);
    msg.appendChild(row);
    messagesEl.appendChild(msg);

    // Render progressively — flush HTML every ~8 chars for a streaming feel
    let rendered = '';
    const chunkSize = 6;
    for (let i = 0; i < content.length; i += chunkSize) {
      rendered += content.slice(i, i + chunkSize);
      bubble.innerHTML = markdownToHtml(rendered);
      scrollToBottom(false);
      await new Promise(r => setTimeout(r, 8));
    }
    // Final full render
    bubble.innerHTML = markdownToHtml(content);
    attachRunButtons();
    checkTriggers(content);
  } else {
    msg.innerHTML = `<div class="message-row"><div class="avatar user">U</div><div class="bubble">${escapeHtml(content)}</div></div>`;
    messagesEl.appendChild(msg);
  }
  scrollToBottom(true);
}

// ============================
// Events
// ============================

function setupEventListeners() {
  sendBtn.onclick = () => sendMessage(inputEl.value);
  inputEl.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(inputEl.value); } });
  inputEl.addEventListener('input', () => { autoResize(); sendBtn.disabled=!inputEl.value.trim()||state.streaming; });
  $('newChatBtn').onclick = createChat;
  $('clearBtn').onclick = () => { const chat=getActiveChat(); if(chat){ chat.messages=[]; chat.title='New Chat'; saveChats(); loadChat(chat.id); } };
  sidebarToggle.onclick = () => sidebar.classList.toggle('collapsed');

  modelSelector.addEventListener('click', e=>{ e.stopPropagation(); modelDropdown.classList.toggle('open'); });
  document.querySelectorAll('.model-option').forEach(opt => {
    opt.addEventListener('click', () => {
      state.provider = opt.dataset.provider || state.provider;
      state.model = opt.dataset.model || state.model;
      updateModelLabel();
      document.querySelectorAll('.model-option').forEach(o=>o.classList.remove('active'));
      opt.classList.add('active');
      modelDropdown.classList.remove('open');
      localStorage.setItem('nc_provider', state.provider);
      localStorage.setItem('nc_model', state.model);
    });
  });
  document.addEventListener('click', () => modelDropdown.classList.remove('open'));
  modelLabel.addEventListener('dblclick', promptForKey);

  document.querySelectorAll('.suggestion-card').forEach(card=>{
    card.onclick=()=>{ const prompt=card.dataset.prompt; inputEl.value=prompt; autoResize(); sendBtn.disabled=false; sendMessage(prompt); };
  });

  // Settings modal
  openSettingsBtn.onclick=()=>{
    apiKeyInput.value=state.apiKey;
    providerSelect.value=state.provider;
    modelSelect.value=state.model;
    systemPromptInput.value=state.systemPrompt;
    renderTriggerList();
    settingsModal.style.display = 'flex';
  };
  closeSettingsBtn.onclick=()=>{ settingsModal.style.display='none'; };
  window.onclick = e => { if(e.target===settingsModal) settingsModal.style.display='none'; };
  addTriggerBtn.onclick = () => {
    state.triggers.push({ match: '', type: 'contains', action: '' });
    renderTriggerList();
  };
  saveSettingsBtn.onclick=()=>{
    state.apiKey = apiKeyInput.value.trim();
    state.provider = providerSelect.value;
    state.model = modelSelect.value.trim() || state.model;
    state.systemPrompt = systemPromptInput.value;
    // Collect triggers from DOM
    state.triggers = [];
    triggerListEl.querySelectorAll('.trigger-row').forEach(row => {
      const match = row.querySelector('.trigger-match').value.trim();
      const type = row.querySelector('.trigger-type').value;
      const action = row.querySelector('.trigger-action').value.trim();
      if (match) state.triggers.push({ match, type, action });
    });
    localStorage.setItem('nc_apikey', state.apiKey);
    localStorage.setItem('nc_provider', state.provider);
    localStorage.setItem('nc_model', state.model);
    localStorage.setItem('nc_systemprompt', state.systemPrompt);
    localStorage.setItem('nc_triggers', JSON.stringify(state.triggers));
    updateModelLabel(); settingsModal.style.display='none';
    showToast('✓ Settings saved');
  };
}

// ============================
// Trigger List UI
// ============================

function renderTriggerList() {
  triggerListEl.innerHTML = '';
  if (state.triggers.length === 0) {
    triggerListEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 2px;">No triggers yet. Add one below — the action runs as JavaScript when the AI response matches.</div>';
    return;
  }
  state.triggers.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'trigger-row trigger-row-vertical';
    const defaultAction = t.action || '// Variables: response (full text), match (array)\n// Examples:\n// alert("AI said: " + match[0])\n// fetch("https://your-webhook.com", { method:"POST", body: response })';
    row.innerHTML = `
      <div class="trigger-row-top">
        <select class="trigger-type">
          <option value="contains" ${t.type==='contains'?'selected':''}>contains</option>
          <option value="regex" ${t.type==='regex'?'selected':''}>regex</option>
        </select>
        <input class="trigger-match" type="text" placeholder="match text or pattern…" value="${escapeHtml(t.match)}">
        <button class="trigger-del-btn" data-i="${i}" title="Delete trigger">×</button>
      </div>
      <div class="trigger-row-bottom">
        <span class="trigger-js-label">JS</span>
        <textarea class="trigger-action" rows="4" spellcheck="false" placeholder="// JS to run. Variables: response, match">${escapeHtml(defaultAction)}</textarea>
      </div>
    `;
    row.querySelector('.trigger-del-btn').onclick = () => {
      state.triggers.splice(i, 1);
      renderTriggerList();
    };
    // Tab key inserts spaces in textarea
    row.querySelector('.trigger-action').addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });
    triggerListEl.appendChild(row);
  });
}

init();