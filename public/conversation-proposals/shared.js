(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const prompt = $('#prompt');
  const conversation = $('#conversation');
  const turns = $('#turns');
  const empty = $('#empty');
  const app = $('#app');
  const composer = $('#composer');
  let mode = 'image';
  let busy = false;
  let toastTimer;
  let ratioIndex = 0;
  let quality = '2K';
  const ratios = ['2:3', '3:2', '1:1', '4:5'];

  function toast(text) {
    const element = $('#toast');
    element.textContent = text;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2400);
  }
  function closeNav() { document.body.classList.remove('nav-open'); }
  function setPrompt(text) {
    prompt.value = text;
    prompt.focus();
    prompt.setSelectionRange(text.length, text.length);
  }
  function showEmpty() {
    turns.hidden = true;
    empty.hidden = false;
    conversation.scrollTop = 0;
    closeNav();
    setPrompt('');
  }
  function showThread() {
    turns.hidden = false;
    empty.hidden = true;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, attributes = {}) {
    const node = element('button', '', text);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    node.type = 'button';
    return node;
  }
  function actions(replyText, withImage = false) {
    const row = element('div', 'message-actions');
    if (withImage) {
      const refine = button('继续修改 ↗', {
        'data-refine': '以这张图片为基础继续修改：保留构图与配色，让品牌字更小、画面更安静。',
      });
      row.append(refine, button('重试', { 'data-retry': '' }));
    }
    row.append(button('复制', { 'data-copy': replyText }));
    return row;
  }
  function addTurn(text, type) {
    showThread();
    const number = turns.querySelectorAll('.turn').length + 1;
    const turn = element('article', 'turn');
    turn.append(element('span', 'turn-number', String(number).padStart(2, '0')));
    const user = element('div', 'user-col');
    const role = element('div', 'role', '你 ');
    role.append(element('time', '', new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })));
    user.append(role, element('p', 'user-text', text));
    if (!$('#attachmentPreview').hidden) user.append(element('span', 'user-ref', '▧ 本轮参考图'));
    const assistant = element('div', 'assistant-col');
    const id = element('div', 'assistant-id');
    id.append(element('span', 'assistant-symbol', document.body.classList.contains('proof') ? 'C' : '初'));
    id.append(document.createTextNode('初稿'));
    id.append(element('span', 'kind', type === 'image' ? '正在生成图片' : type === 'agent' ? '整理创作方向' : '讨论想法'));
    const replyText = type === 'image'
      ? '我会接着当前对话做这一稿，保留已经确定的气质，把你刚才说的内容作为这一轮的重点。'
      : type === 'agent'
        ? `我先把这项目标整理成可执行的创作步骤：明确画面主体、统一视觉方向，再确认生成参数。你说的重点是「${text.slice(0, 55)}${text.length > 55 ? '…' : ''}」。`
        : `我把这一点理解为下一稿的方向：「${text.slice(0, 75)}${text.length > 75 ? '…' : ''}」。可以继续说说最想保留、和最想去掉的部分，我们再决定怎么改。`;
    const reply = element('div', 'reply');
    reply.append(element('p', '', replyText));
    assistant.append(id, reply);
    if (type === 'image') {
      id.append(element('span', 'image-index', '生成中'));
      const card = element('div', 'result-card');
      const visual = element('div', 'result-visual');
      const pending = element('div', 'pending-image');
      pending.append(element('span', '', '正在生成新一张…'), element('div', 'pending-line'));
      visual.append(pending);
      const info = element('div', 'result-info');
      info.append(element('h3', '', '山隐 · 新一稿'), element('p', '', '沿用当前创作方向\n保留旧稿，不覆盖历史'));
      const params = element('div', 'result-params');
      const rows = [['模型', $('#model').value], ['画幅', `${ratios[ratioIndex]} · ${quality}`], ['数量', '1 张']];
      rows.forEach(([label, value]) => {
        const row = element('div');
        row.append(element('span', '', label), element('b', '', value));
        params.append(row);
      });
      info.append(params);
      card.append(visual, info);
      assistant.append(card);
      turn.append(user, assistant);
      turns.append(turn);
      conversation.scrollTop = conversation.scrollHeight;
      return { turn, id, visual, info, replyText };
    }
    assistant.append(actions(replyText));
    turn.append(user, assistant);
    turns.append(turn);
    conversation.scrollTop = conversation.scrollHeight;
    return { turn, replyText };
  }
  function completeImage(result) {
    const open = button('', { 'aria-label': '放大新作品', 'data-image': 'tea-concept.svg', class: 'image-open' });
    const image = element('img');
    image.src = 'tea-concept.svg';
    image.alt = '山隐高山绿茶包装概念新稿';
    open.append(image);
    result.visual.replaceChildren(open);
    result.id.querySelector('.kind').textContent = '已生成图片';
    result.id.querySelector('.image-index').textContent = `图 ${$$('.result-card').length}`;
    result.info.append(actions(result.replyText, true));
    result.turn.classList.add('is-new');
    conversation.scrollTop = conversation.scrollHeight;
  }
  function submit(type) {
    const text = prompt.value.trim();
    if (busy) return;
    if (!text) { toast('先写一句想法，再发送或生图'); prompt.focus(); return; }
    busy = true;
    $('#generate').disabled = true;
    $('#send').disabled = true;
    const result = addTurn(text, type);
    prompt.value = '';
    setTimeout(() => {
      if (type === 'image') completeImage(result);
      busy = false;
      $('#generate').disabled = false;
      $('#send').disabled = false;
      toast(type === 'image' ? '新一稿已加入这段对话' : '已回复，创作记录已保留');
    }, type === 'image' ? 1400 : 600);
  }
  function setMode(next) {
    mode = next;
    $$('[data-mode]').forEach(item => item.classList.toggle('active', item.dataset.mode === mode));
    const copy = {
      image: ['当前想法会直接生成图片', '描述画面、风格和你想保留的细节……', '生图', '发送用于讨论，生图会把当前想法变成画面'],
      chat: ['先讨论清楚，再决定要不要出图', '聊聊你的想法，或询问设计建议……', '生图', '当前是讨论模式；点击生图仍可生成图片'],
      agent: ['从目标到画面，由 Agent 分步推进', '告诉我你的创作目标或需要调整的地方……', '开始规划', '创作 Agent 会整理目标，再与你确认方向'],
    }[mode];
    $('#modeNote').textContent = copy[0];
    prompt.placeholder = copy[1];
    $('#generateText').textContent = copy[2];
    $('#dockHint').textContent = copy[3];
  }
  function openImage(src) {
    $('#largeImage').src = src;
    $('#lightbox').showModal();
  }

  $('#newChat').addEventListener('click', showEmpty);
  $$('.thread').forEach(thread => thread.addEventListener('click', () => {
    $$('.thread').forEach(item => item.classList.remove('active'));
    thread.classList.add('active');
    $('#conversationTitle').textContent = thread.dataset.title;
    showThread();
    closeNav();
  }));
  $('#search').addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    $$('.thread').forEach(thread => { thread.hidden = !thread.textContent.toLowerCase().includes(query); });
  });
  $('#menuToggle').addEventListener('click', () => {
    if (matchMedia('(max-width:760px)').matches) document.body.classList.toggle('nav-open');
    else app.classList.toggle('collapsed');
  });
  $('#closeNav').addEventListener('click', event => { event.preventDefault(); closeNav(); });
  $('#scrim').addEventListener('click', closeNav);
  $$('[data-mode]').forEach(item => item.addEventListener('click', () => setMode(item.dataset.mode)));
  composer.addEventListener('submit', event => { event.preventDefault(); submit(mode); });
  $('#send').addEventListener('click', () => { setMode('chat'); submit('chat'); });
  prompt.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit(mode === 'image' ? 'chat' : mode);
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit(mode);
    }
  });
  prompt.addEventListener('input', () => {
    prompt.style.height = 'auto';
    prompt.style.height = `${Math.min(prompt.scrollHeight, 110)}px`;
  });
  $('#model').addEventListener('change', event => toast(`已选择 ${event.target.value}`));
  $('#params').addEventListener('click', event => {
    if (event.shiftKey) quality = quality === '2K' ? '4K' : '2K';
    else ratioIndex = (ratioIndex + 1) % ratios.length;
    event.currentTarget.textContent = `${ratios[ratioIndex]} · ${quality} · 1 张⌄`;
    toast('参数已更新；Shift + 点击切换质量');
  });
  $('#attach').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $('#attachmentImage').src = reader.result;
      $('#attachmentPreview').hidden = false;
      toast('参考图已加入本轮对话');
    };
    reader.readAsDataURL(file);
  });
  $('#removeAttachment').addEventListener('click', () => {
    $('#attachmentPreview').hidden = true;
    $('#fileInput').value = '';
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.starter) { showThread(); setMode('image'); setPrompt(target.dataset.starter); }
    if (target.dataset.edit) { setPrompt(target.dataset.edit); toast('已放回输入框，可以继续编辑'); }
    if (target.dataset.refine) { setMode('image'); setPrompt(target.dataset.refine); toast('将以上一稿为参考，不覆盖旧稿'); }
    if (target.hasAttribute('data-retry')) { setMode('image'); setPrompt('沿用刚才的描述，重新生成一张，保留其他参数。'); toast('重试内容已准备好，确认后生图'); }
    if (target.dataset.copy) {
      const text = target.dataset.copy;
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('已复制')).catch(() => toast('请手动选择文字复制'));
      else toast('请手动选择文字复制');
    }
    if (target.dataset.image) openImage(target.dataset.image);
    if (target.dataset.demo) toast(`${target.dataset.demo}沿用当前项目页面；这里只预览对话视觉`);
  });
  $('#share').addEventListener('click', () => toast('当前对话分享链接（原型演示）'));
  $('#more').addEventListener('click', () => toast('可接入现有的重命名、归档与复制对话'));
  $('#closeDialog').addEventListener('click', () => $('#lightbox').close());
  $('#lightbox').addEventListener('click', event => { if (event.target === $('#lightbox')) $('#lightbox').close(); });
})();
