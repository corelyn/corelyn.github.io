// ============================
// NeuralChat — app.js (Multi-Provider + Settings Modal)
// ============================

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

  chat.messages.push({ role: 'user', content }); renderMessage('user', content); updateChatTitle(chat, content); saveChats();
  inputEl.value = ''; autoResize(); sendBtn.disabled = true;
  const typingEl = showTyping(); state.streaming = true;

  try {
    const assistantText = await callProvider(chat.messages); typingEl.remove();
    chat.messages.push({ role: 'assistant', content: assistantText }); saveChats(); renderMessage('assistant', assistantText);
  } catch (err) {
    console.warn("Primary failed:", err);
    try {
      const fallback = await callFallback(content); typingEl.remove();
      chat.messages.push({ role: 'assistant', content: fallback.response }); saveChats(); renderMessage('assistant', fallback.response);
    } catch (fallbackErr) {
      typingEl.remove(); renderError(fallbackErr.message || 'All providers failed.');
    }
  }
  state.streaming = false;
}

// ============================
// Provider & Fallback
// ============================

async function callProvider(messages) {
  const provider = PROVIDERS[state.provider]; if (!provider) throw new Error("Invalid provider");

  if (state.provider === 'anthropic') {
    const res = await fetch(provider.endpoint, { method: 'POST', headers: { 'Content-Type':'application/json', 'x-api-key':state.apiKey, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true' }, body: JSON.stringify({ model: state.model, max_tokens: 4096, messages: messages.map(m=>({role:m.role,content:m.content})) }) });
    if (!res.ok) throw new Error("Anthropic error"); const data = await res.json(); return data.content?.[0]?.text || "(no response)";
  }

  const res = await fetch(provider.endpoint, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${state.apiKey}`}, body:JSON.stringify({ model: state.model, messages: messages, temperature:0.7 }) });
  if (!res.ok) throw new Error("Provider error"); const data = await res.json(); return data.choices?.[0]?.message?.content || "(no response)";
}

async function callFallback(message) {
  const res = await fetch(FALLBACK_ENDPOINT, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ prompt:message, model:'gpt-3.5-turbo' }) });
  const data = await res.json();
  if (data.response) return { response: data.response }; if (data.error) throw new Error(data.error); throw new Error("Fallback failed");
}

// ============================
// Rendering
// ============================

function renderMessage(role, content) {
  const msg = document.createElement('div'); msg.className = `message ${role}`;
  msg.innerHTML = `<div class="message-row"><div class="avatar ${role}">${role==='user'?'U':'✦'}</div><div class="bubble">${escapeHtml(content)}</div></div>`;
  messagesEl.appendChild(msg); scrollToBottom(true);
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

function escapeHtml(str) { return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function scrollToBottom(smooth){ const container = document.querySelector('.messages-container'); container.scrollTop = container.scrollHeight; }
function autoResize(){ inputEl.style.height='auto'; inputEl.style.height=Math.min(inputEl.scrollHeight,200)+'px'; }
function updateChatTitle(chat,content){ if(chat.title==='New Chat'){ chat.title=content.slice(0,40); topbarTitle.textContent=chat.title; } }
function updateModelLabel(){ modelLabel.textContent=`${state.provider} • ${state.model}`; }

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
      state.provider = opt.dataset.provider;
      state.model = opt.dataset.model;
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
  openSettingsBtn.onclick=()=>{ apiKeyInput.value=state.apiKey; providerSelect.value=state.provider; modelSelect.value=state.model; settingsModal.style.display = 'flex'; };
  closeSettingsBtn.onclick=()=>{ settingsModal.style.display='none'; };
  window.onclick = e => { if(e.target===settingsModal) settingsModal.style.display='none'; };
  saveSettingsBtn.onclick=()=>{
    state.apiKey = apiKeyInput.value.trim();
    state.provider = providerSelect.value;
    state.model = modelSelect.value.trim() || state.model;
    localStorage.setItem('nc_apikey', state.apiKey);
    localStorage.setItem('nc_provider', state.provider);
    localStorage.setItem('nc_model', state.model);
    updateModelLabel(); settingsModal.style.display='none'; alert('Settings saved!');
  };
}

init();
