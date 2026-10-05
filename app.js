(async function(){
  'use strict';
  if(window.READER_ENTRY_ONLY)return;
  const $=id=>document.getElementById(id);
  let database;
  try{database=await LocalDB.open();}catch(error){$('sentence').textContent=error.message;$('storage-status').textContent=window.READEVERYDAY_BROWSER?'浏览器体验版未加载 · 请刷新重试，保留已有记录':'数据库未连接 · 请勿清除浏览器备份';$('complete').disabled=true;$('previous').disabled=true;$('next').disabled=true;return;}
  const isBrowser=database?.kind==='browser';
  let data=database?database.data:window.READ_DATA,core=ReadCore.create(data);
  let STORAGE=database?'read-everyday-db-backup:'+data.id:'read-everyday-v1'+(new URLSearchParams(location.search).get('qa')==='1'?'-qa':'');
  const wordDialog=$('word-dialog'),panelDialog=$('panel-dialog');
  let state=core.blank(),storageOK=true,activeWord=null,toastTimer,dialogBackPending=false,stopped=false;
  let initialNotice='',switching=false,historyRequest=0,sessionOperations=0,queuedArticle=null;
  try { if(database)state=database.state;else{const raw=localStorage.getItem(STORAGE);if(raw)state=core.validate(JSON.parse(raw));} }
  catch(error){if(error instanceof SyntaxError||error.message.includes('无效')||error.message.includes('词条')||error.message.includes('文件'))initialNotice='保存的进度无法读取，已从第一句开始。';else storageOK=false;}
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>ReadCore.dayKey();
  const todayRead=()=>state.days[today()]||[];
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
  function save(){if(stopped)return;if(!isBrowser){try{localStorage.setItem(STORAGE,JSON.stringify(state));storageOK=true;}catch{storageOK=false;}}if(database)database.save(state);updateStorageLabel();}
  function updateStorageLabel(){
    if(database){const labels=database.cloud?{checking:'已恢复浏览器副本 · 正在核对云端进度…',saved:'已保存到账号 · 可跨设备接续',saving:'正在同步到账号…',pending:'有待同步记录',error:'云端连接失败 · 设置中可重试或导出',conflict:'记录或账号有变化 · 请在设置中重试或导出'}:isBrowser?{saved:'已保存到此浏览器',saving:'正在保存…',pending:'有待保存记录',error:'浏览器保存失败 · 设置中可重试或导出',conflict:'另一页面更新了记录 · 设置中可合并并重试'}:{saved:'已保存到本机个人数据库',saving:'正在保存到本机数据库…',pending:'有待保存记录',error:'数据库保存失败 · 请勿关闭，设置中可重试或导出',conflict:'另一页面更新了记录 · 设置中可合并并重试'};$('storage-status').textContent=labels[database.status]+(storageOK?'':' · 浏览器副本不可用');return;}
    $('storage-status').textContent=storageOK?'浏览器模式 · 未接入本机数据库':'浏览器未允许保存进度 · 可在设置中导出备份';
  }
  function subscribeDatabase(){const target=database;target?.subscribe((status,cacheOK,updated)=>{if(target!==database)return;storageOK=cacheOK;if(updated){state=core.validate(updated);render();}else updateStorageLabel();});}
  subscribeDatabase();
  function updateStats(){
    if(stopped)return;
    const count=todayRead().length;
    $('date').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'});
    $('daily-count').textContent=count;$('daily-fill').style.width=count?'100%':'0';
    $('daily-title').textContent=count?'今天的一小步，完成了。':'今天，看懂一句就好。';
    $('daily-caption').textContent=count?'可以安心收工，也可以再读一句。':'给英文一点点时间。';
    $('daily-note').textContent=count?'这就很好，明天接着来。':'不用赶进度，从这里开始。';
    $('article-progress').textContent=`${state.read.length} / ${data.sentences.length} 句已读`;
    $('saved-count').textContent=state.saved.length;
    $('complete').disabled=todayRead().includes(state.index);
    $('complete').innerHTML=todayRead().includes(state.index)?'今天已读懂 <span>✓</span>':'这句读懂了 <span>✓</span>';
    $('full-article').hidden=state.read.length!==data.sentences.length;
    $('encouragement').hidden=!todayRead().includes(state.index);
    if(!$('encouragement').hidden)$('encouragement').textContent=count===1?'今天的小目标完成了。停在这里就很好，明天再见。':`今天已经读懂 ${count} 句。随时可以停下，下次从这里继续。`;
    updateStorageLabel();
  }
  function render(){
    document.querySelector('.article-name').textContent=data.title;
    document.querySelector('.article-desc').textContent=data.subtitle||'';
    document.querySelector('.article-source').textContent=data.source;
    const sentence=data.sentences[state.index];document.body.classList.toggle('large-text',state.large);
    $('sentence-index').textContent=`SENTENCE ${String(state.index+1).padStart(2,'0')} / ${data.sentences.length}`;
    $('paragraph-label').textContent=`第 ${sentence.p} 段 · ${data.source}`;
    $('sentence-progress').replaceChildren();
    data.sentences.forEach((s,i)=>{const b=document.createElement('button');b.className=`step${state.read.includes(i)?' done':''}${i===state.index?' current':''}`;b.title=`第 ${i+1} 句${state.read.includes(i)?' · 已读':''}`;b.setAttribute('aria-label',b.title);if(i===state.index)b.setAttribute('aria-current','step');b.onclick=()=>navigate(i);$('sentence-progress').append(b);});
    $('sentence').classList.toggle('long-sentence',sentence.text.length>240);
    $('sentence').replaceChildren();
    ReadCore.tokenize(sentence.text).forEach(token=>{
      if(!ReadCore.isWord(token)){$('sentence').append(document.createTextNode(token));return;}
      const b=document.createElement('button');b.textContent=token;b.className='word';b.dataset.word=token;b.setAttribute('aria-label',`查词 ${token}`);
      if(state.saved.some(x=>x.kind==='word'&&x.key===token&&x.sentence===state.index))b.classList.add('saved');
      b.onclick=()=>openWord(token,'word',state.index);$('sentence').append(b);
    });
    $('phrases').replaceChildren();
    if(sentence.phrases.length){const label=document.createElement('span');label.className='phrase-label';label.textContent='一起看';$('phrases').append(label);}
    sentence.phrases.forEach(key=>{const b=document.createElement('button');b.className='phrase-chip';b.textContent=key;b.onclick=()=>openWord(key,'phrase',state.index);$('phrases').append(b);});
    $('structure-content').innerHTML=`<div class="grammar-main"><strong>句子主干</strong><span lang="en">${escape(sentence.main)}</span></div>${sentence.parts.map(([en,zh])=>`<div class="grammar-item"><b lang="en">${escape(en)}</b><br>${escape(zh)}</div>`).join('')}`;
    $('translation-content').textContent=sentence.zh;
    $('context-content').replaceChildren();
    data.sentences.forEach((s,i)=>{if(s.p!==sentence.p)return;const b=document.createElement('button');b.className=`context-goto context-sentence${i===state.index?' context-current':''}`;b.textContent=s.text;b.title=`跳到第 ${i+1} 句`;b.onclick=()=>navigate(i);$('context-content').append(b,document.createTextNode(' '));});
    $('previous').disabled=state.index===0;$('next').disabled=state.index===data.sentences.length-1;
    updateStats();
  }
  function navigate(index){
    if(stopped||!core.validIndex(index))return;
    state.index=index;['structure','translation','context'].forEach(id=>$(id).open=false);save();render();
    // 长句底部点击下一句后，重新看到新句开头；首屏无需移动。
    const card=document.querySelector('.reader-card');
    if(card.getBoundingClientRect().top<0)card.scrollIntoView({block:'start',behavior:'instant'});
  }
  function modal(dialog){
    if(wordDialog.open||panelDialog.open)return;
    if(dialogBackPending){setTimeout(()=>modal(dialog),100);return;}
    try{history.pushState({readEverydayDialog:true},'');dialog.dataset.hasHistory='true';}catch{dialog.dataset.hasHistory='false';}
    dialog.showModal();dialog.scrollTop=0;
  }
  function close(dialog,fromHistory=false){
    if(!dialog.open)return;dialog.close();
    if(dialog===wordDialog)window.ReadWordLibrary?.stop();
    if(dialog===wordDialog&&activeWord?.sentence===state.index){
      const target=activeWord.kind==='word'?[...$('sentence').querySelectorAll('button')].find(b=>b.dataset.word===activeWord.key):[...$('phrases').querySelectorAll('button')].find(b=>b.textContent===activeWord.key);
      target?.focus({preventScroll:true});
    }
    if(!fromHistory&&dialog.dataset.hasHistory==='true'&&history.state?.readEverydayDialog){dialogBackPending=true;history.back();setTimeout(()=>dialogBackPending=false,350);}dialog.dataset.hasHistory='false';
  }
  window.addEventListener('popstate',()=>{
    dialogBackPending=false;close(wordDialog,true);close(panelDialog,true);
    if(isBrowser){const id=new URLSearchParams(location.search).get('article')||window.READEVERYDAY_RELEASE?.defaultArticle;if(id&&(id!==data.id||switching))void switchArticle(id,true);}
  });
  async function switchArticle(id,fromHistory=false){
    if(stopped)return;
    if(switching){queuedArticle={id,fromHistory};return;}
    if(sessionOperations){toast('当前保存或账号操作尚未完成，请稍后换篇。');if(fromHistory){const url=new URL(location.href);url.searchParams.set('article',data.id);history.replaceState(null,'',url.href);}return;}
    switching=true;historyRequest++;const previous=database;let next;
    try{
      if(previous.pending){await previous.retry();if(previous.pending)throw Error('还有未同步记录，请在设置中重试或导出后再换篇。');}
      next=await LocalDB.open(id);
      const nextCore=ReadCore.create(next.data);nextCore.validate(next.state);
      if(queuedArticle){next.dispose?.({preservePending:true});next=null;return;}
      // An operation may have been saved while the next article was loading.
      if(previous.pending){await previous.retry();if(previous.pending)throw Error('还有未同步记录，请先重试或导出。');}
      if(queuedArticle){next.dispose?.({preservePending:true});next=null;return;}
      if(sessionOperations)throw Error('当前保存或账号操作尚未完成，请稍后换篇。');
      previous.dispose?.();
      const hadDialogHistory=panelDialog.open&&panelDialog.dataset.hasHistory==='true';
      close(wordDialog,true);close(panelDialog,true);window.ReadWordLibrary?.stop();activeWord=null;
      database=next;data=next.data;core=nextCore;state=nextCore.validate(next.state);STORAGE='read-everyday-db-backup:'+data.id;
      ['structure','translation','context'].forEach(id=>$(id).open=false);
      const url=new URL(location.href);url.search='';url.searchParams.set('article',data.id);url.hash='';
      history[fromHistory||hadDialogHistory?'replaceState':'pushState']({readEverydayArticle:data.id},'',url.href);
      subscribeDatabase();render();LocalDB.warm?.(data.id);
      const card=document.querySelector('.reader-card');if(card.getBoundingClientRect().top<0)card.scrollIntoView({block:'start',behavior:'instant'});
    }catch(error){
      if(next&&next!==database)next.dispose?.({preservePending:true});
      if(fromHistory){const url=new URL(location.href);url.search='';url.searchParams.set('article',data.id);history.replaceState({readEverydayArticle:data.id},'',url.href);}
      toast(error.message||'这篇文章暂时无法打开，请重试。');
    }finally{switching=false;if(queuedArticle){const queued=queuedArticle;queuedArticle=null;await switchArticle(queued.id,queued.fromHistory);}}
  }
  [wordDialog,panelDialog].forEach(dialog=>{
    dialog.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>close(dialog));
    dialog.addEventListener('cancel',e=>{e.preventDefault();close(dialog);});
    dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close(dialog);});
  });
  function openWord(key,kind,index){
    window.ReadWordLibrary?.stop();
    const entry=kind==='phrase'?data.phrases[key]:core.lookup(key,index);
    if(!entry){toast('这个词还未收录，可先查看整句翻译。');return;}
    activeWord={key,kind,sentence:index};
    const lemma=kind==='phrase'?'短语 · 看作一个整体来理解':`词形 ${key}${entry.form?' · '+entry.form:''}`;
    $('word-content').innerHTML=`<div class="word-heading"><h2 id="word-title" lang="en">${escape(key)}</h2><span class="pos">${escape(entry.pos)}</span></div><p class="lemma">${escape(lemma)}</p><div class="sense-label">${kind==='phrase'?'在这句话里':'本文语境优先'}</div><p class="meaning">${escape(entry.meaning)}</p>${entry.usage?`<p class="usage">${escape(entry.usage)}</p>`:''}<div class="example"><span class="sense-label">用一个小例句记住它</span><p lang="en">${escape(entry.example)}</p><small>${escape(entry.exampleZh)}</small></div>`;
    refreshSaveButton();modal(wordDialog);
    if(kind==='word'&&window.ReadWordLibrary?.mount)void window.ReadWordLibrary.mount($('word-content'),data.id,index,key);
  }
  const savedIndex=()=>state.saved.findIndex(x=>x.key===activeWord.key&&x.kind===activeWord.kind&&x.sentence===activeWord.sentence);
  function refreshSaveButton(){$('save-word').textContent=savedIndex()>=0?'已在词本 ✓':'＋ 收进词本';$('save-word').disabled=savedIndex()>=0;}
  $('save-word').onclick=()=>{if(!activeWord||savedIndex()>=0)return;state.saved.push({...activeWord});save();refreshSaveButton();render();toast('收好了，下次在「我的词本」里见。');};
  $('complete').onclick=()=>{
    const d=today();if(!state.days[d])state.days[d]=[];
    if(!state.days[d].includes(state.index))state.days[d].push(state.index);
    if(!state.read.includes(state.index))state.read.push(state.index);
    save();render();
  };
  $('previous').onclick=()=>navigate(state.index-1);$('next').onclick=()=>navigate(state.index+1);
  document.querySelector('.brand').onclick=e=>{e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});};
  document.addEventListener('keydown',e=>{if(stopped||wordDialog.open||panelDialog.open||e.ctrlKey||e.altKey||e.metaKey||e.target.matches('input,textarea,select,summary'))return;if(e.key==='ArrowLeft'){e.preventDefault();navigate(state.index-1);}if(e.key==='ArrowRight'){e.preventDefault();navigate(state.index+1);}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateStats();});
  setInterval(updateStats,60000);
  function notebook(){
    $('panel-title').textContent='我的词本';
    $('panel-content').innerHTML=`<p class="panel-intro">${state.saved.length?'带着原句记忆。相同单词在不同句子里可以分别收藏。':'遇到想记住的词，点开词卡，选择「收进词本」。'}</p>`;
    if(!state.saved.length){$('panel-content').insertAdjacentHTML('beforeend','<div class="empty-state">词本还是空的。<br>从第一个让你好奇的词开始。</div>');}
    [...state.saved].reverse().forEach(item=>{
      const entry=item.kind==='word'?core.lookup(item.key,item.sentence):data.phrases[item.key];
      const section=document.createElement('section');section.className='saved-entry';
      section.innerHTML=`<h3>${escape(item.key)} <small>${escape(entry.pos)}</small></h3><p>${escape(entry.meaning)}</p><p class="saved-context" lang="en">${escape(data.sentences[item.sentence].text)}</p>`;
      const back=document.createElement('button');back.className='secondary-button';back.textContent=`回到第 ${item.sentence+1} 句`;back.onclick=()=>{close(panelDialog);navigate(item.sentence);};
      const remove=document.createElement('button');remove.className='quiet-button';remove.textContent='移出词本';remove.onclick=()=>{state.saved=state.saved.filter(x=>!(x.key===item.key&&x.kind===item.kind&&x.sentence===item.sentence));save();render();notebook();};
      section.append(back,remove);$('panel-content').append(section);
    });
    if(!panelDialog.open)modal(panelDialog);
  }
  $('notebook').onclick=notebook;
  function fullArticle(){
    $('panel-title').textContent=data.title;
    $('panel-content').innerHTML=`<p class="panel-intro">${escape(data.source)}<br>${escape(data.sourceNote)}</p><div class="article-full">${[...new Set(data.sentences.map(s=>s.p))].map(p=>`<p lang="en">${data.sentences.filter(s=>s.p===p).map(s=>escape(s.text)).join(' ')}</p>`).join('')}</div>`;
    modal(panelDialog);
  }
  $('article-info').onclick=fullArticle;$('full-article').onclick=fullArticle;
  $('library').onclick=()=>{if(database){if(!panelDialog.open)modal(panelDialog);void readingHistory();}else toast('请从“启动阅读.vbs”进入完整题库。');};
  async function readingHistory(){
    const target=database,request=++historyRequest;
    $('panel-title').textContent='阅读记录与历史';$('panel-content').textContent='正在读取题库与历史…';
    try{
      const [history,catalog]=await Promise.all([target.history({cached:true}),target.catalog()]);
      if(target!==database||request!==historyRequest||$('panel-title').textContent!=='阅读记录与历史')return;
      draw(history,catalog,target.cloud?'题库已就绪，正在更新云端历史…':'');
      if(target.cloud)void target.history().then(remote=>{
        if(target===database&&request===historyRequest&&panelDialog.open&&$('panel-title').textContent==='阅读记录与历史')draw(remote,catalog,'');
      }).catch(()=>{if(target===database&&request===historyRequest&&$('history-notice'))$('history-notice').textContent='云端历史暂时不可用，已显示此账号在浏览器中的记录。';});
    }catch{if(target===database&&request===historyRequest)$('panel-content').textContent=isBrowser?'读取失败，请刷新重试，并保留已有浏览器记录。':'读取失败，请确认本地服务仍在运行。未修改已有记录。';}
    function draw(history,catalog,notice){
      const names=Object.fromEntries(catalog.map(a=>[a.id,a.source||a.title]));
      $('panel-content').innerHTML=database.cloud?'<p class="panel-intro">学习历史来自当前账号。仅记录明确标记为读懂的每日完成项，不把翻页算作完成。</p>':isBrowser?'<p class="panel-intro">学习记录保存在此浏览器。仅记录明确标记为读懂的每日完成项，不把翻页算作完成。</p>':'<p class="panel-intro">个人历史存于 personal.sqlite3；题库来自 content.sqlite3。仅记录明确标记为读懂的每日完成项，不把翻页算作完成。</p>';
      if(database.cloud){const hint=document.createElement('p');hint.id='history-notice';hint.textContent=notice;hint.setAttribute('role','status');$('panel-content').append(hint);}
      for(const article of catalog){
        const record=history.articles.find(a=>a.articleId===article.id),section=document.createElement('section');section.className='saved-entry';
        section.innerHTML=`<h3>${escape(article.title)}</h3><p>${escape(article.source)} · ${record?record.readCount:0} 句已读${record?' · 上次停在第 '+(record.index+1)+' 句':''}</p>`;
        const button=document.createElement('button');button.className='secondary-button';button.textContent=record?'继续阅读':'开始阅读';
        button.onclick=()=>{if(article.id===data.id&&!switching){close(panelDialog);navigate(state.index);}else if(isBrowser){button.disabled=true;button.textContent='正在打开…';void switchArticle(article.id).finally(()=>{button.disabled=false;button.textContent=record?'继续阅读':'开始阅读';});}else if(database.pending)toast('还有未保存记录，请先保存或导出。');else{const url=new URL(location.href);url.search='';url.searchParams.set('article',article.id);url.hash='';location.href=url.href;}};
        if(isBrowser)button.onpointerenter=button.onfocus=()=>void LocalDB.prefetch?.(article.id);
        section.append(button);$('panel-content').append(section);
      }
      const heading=document.createElement('h3');heading.textContent='每日完成历史';$('panel-content').append(heading);
      for(const day of history.days){const p=document.createElement('p');p.textContent=`${day.day} · ${names[day.articleId]||day.articleId} · ${day.count} 句`;$('panel-content').append(p);}
      if(!history.days.length)$('panel-content').insertAdjacentHTML('beforeend','<p>尚无完成记录。旧版记录可在设置中导入。</p>');
    }
  }
  function settings(){
    $('panel-title').textContent='按你的节奏来';
    $('panel-content').innerHTML=`<p class="panel-intro">ReadEveryday 1.0 · 一篇文章，18 个小步。</p><section class="settings-row"><h3>阅读字号</h3><button id="font-normal" class="secondary-button">标准</button> <button id="font-large" class="secondary-button">大一点</button></section><section class="settings-row"><h3>进度随身带</h3><p>记录保存在当前浏览器。更换设备、浏览器、打开地址或清除浏览器数据，都可能让记录无法接续。导出一份备份，可以带到另一台设备导入。导入会合并词本和已读记录，并接着备份中的句子读。</p><button id="export" class="secondary-button">导出进度</button> <label class="secondary-button file-label" for="import">导入进度</label><input type="file" id="import" accept=".json,application/json" hidden></section><section class="settings-row"><h3>这篇文章</h3><p>${escape(data.sourceNote)}</p><button id="show-full" class="secondary-button">查看完整文章</button></section><section class="settings-row"><h3>关于这个小工具</h3><p>每天看懂一句就算完成。无需账号，点词和学习记录不发送到服务器。1.0 只收录当前这篇真题的词汇和短语。释义与学习提示可随内容文件修订。</p><p>手机使用时，请通过浏览器打开页面；电脑可直接双击 index.html。手机和电脑不会自动同步进度。</p></section>`;
    $('font-normal').setAttribute('aria-pressed',!state.large);$('font-large').setAttribute('aria-pressed',state.large);
    if(database){
      $('panel-content').querySelector('.panel-intro').textContent=`ReadEveryday ${isBrowser?'浏览器体验版':'本地数据库版'} · 当前文章 ${data.sentences.length} 句`;
      $('export').closest('section').querySelector('p').textContent=database.cloud?'进度、每日完成项和词本保存在当前账号，浏览器保留待同步副本。导出的 JSON 包含当前文章记录，可自行备份；访客或本机旧进度只有在你主动导入时才会进入账号。':'记录'+(isBrowser?'只保存在当前浏览器，不会发送到服务器。导出的 JSON 包含当前文章的进度和词本，可在同一篇文章页面导入。清除网站数据或换浏览器前，请先导出备份。':'保存在电脑的 personal.sqlite3，浏览器保留待保存副本。迁移旧版：先在原 HTML 页面导出进度，再在这里导入；不会清除旧版记录。这里导出的 JSON 只包含当前文章，全部历史请停服后备份 storage 文件夹。');
      const about=$('panel-content').lastElementChild;
      about.innerHTML=isBrowser?'<h3>打开网址，就能读</h3><p>文章与词卡按发布版本缓存，换篇直接更新阅读内容。无需账号即可体验，访客记录保存在当前浏览器；登录同一个阅读账号后，可在手机和电脑上接续进度与词本。</p><p>首次打开、未缓存内容和云同步需要联网，缓存可能被浏览器清理；尚未提供完整离线启动。关闭页面前请留意保存状态；公共设备用完后请退出账号。</p>':'<h3>只在这台电脑上</h3><p>正文、内置释义和学习记录可离线使用。关闭网页后本机服务仍在后台运行；下次双击“启动阅读.vbs”会直接进入。重启电脑后不会自行启动。</p><button id="quit-reader" class="secondary-button">退出阅读并关闭本机服务</button><p>退出会停止所有已打开阅读页面的保存服务；请先确认其他页面也已保存。</p>';
      if(!isBrowser)$('quit-reader').onclick=async()=>{
        if(database.pending){toast('还有未保存记录，请先重试保存或导出。');return;}
        if(!window.confirm('关闭本机阅读服务？请确认其他阅读页面也已保存。'))return;
        try{const r=await fetch('/api/shutdown',{method:'POST',headers:{'X-ReadEveryday':'local-v1'}});if(!r.ok)throw Error('Stop failed');stopped=true;clearTimeout(toastTimer);document.body.innerHTML='<main class="entry-page"><div class="entry-mark">r·</div><h1>今天就读到这里。</h1><p>本机服务已关闭，可以关掉这个页面。</p><p>下次双击「启动阅读.vbs」，接着读。</p></main>';}catch{toast('未能关闭，请稍后重试。');}
      };
      const section=document.createElement('section');section.className='settings-row';section.innerHTML=`<h3>${isBrowser?'题库与阅读记录':'本地题库与个人数据'}</h3><button id="reading-history" class="secondary-button">阅读记录与历史／题库</button> <button id="retry-database" class="secondary-button">合并并重试保存</button><p>遇到多页面冲突，重试会合并已读记录和词本，保留本页阅读位置；另一页面移除过的收藏可能重新出现。</p>`;
      $('panel-content').prepend(section);$('reading-history').onclick=readingHistory;
      if(database.cloud){$('retry-database').textContent='同步并重试保存';section.querySelector('p').textContent='两台设备修改同一篇文章时，会合并已读记录和新增词本，并保留任一设备明确移除的旧收藏。网络恢复后会继续同步；未同步时请先导出再换设备。';}
      $('retry-database').onclick=async()=>{sessionOperations++;try{state=core.validate(await database.retry());render();toast(database.status==='saved'?(database.cloud?'已保存到账号。':isBrowser?'已保存到此浏览器。':'已保存到本机数据库。'):'仍未保存，请保持页面打开或导出备份。');}catch{toast('重试失败，请保留页面并导出备份。');}finally{sessionOperations--;}};
    }
    $('font-normal').onclick=()=>{state.large=false;save();render();settings();};$('font-large').onclick=()=>{state.large=true;save();render();settings();};
    $('export').onclick=()=>{
      const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ReadEveryday-progress-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('进度已导出。');
    };
    $('import').onchange=async e=>{
      const file=e.target.files[0];if(!file)return;
      sessionOperations++;try{if(file.size>1024*1024)throw Error('文件太大');const incoming=core.validate(JSON.parse(await file.text()));state=core.merge(state,incoming);save();render();toast('进度已合并，可以接着读了。');close(panelDialog);}catch{toast('导入失败：请选择 ReadEveryday 导出的有效进度 JSON。');e.target.value='';}finally{sessionOperations--;}
    };
    $('show-full').onclick=()=>{fullArticle();panelDialog.scrollTop=0;};
    if(!panelDialog.open)modal(panelDialog);
  }
  function accountPanel(mode='login',username='',message=''){
    const cloud=window.ReaderCloud;
    if(!cloud)return;
    $('panel-title').textContent=database.cloud?'阅读账号':'登录阅读账号';
    $('panel-content').replaceChildren();
    const section=document.createElement('section');section.className='account-panel';
    if(database.cloud){
      section.innerHTML=`<p class="panel-intro"><strong>${escape(database.user.user_metadata?.reader_username||database.user.email||'已登录')}</strong> · 进度与词本可跨设备接续。</p><div class="account-actions"><button id="cloud-refresh" class="secondary-button">刷新云端记录</button><button id="cloud-logout" class="secondary-button">退出账号</button></div><form id="cloud-password-form" class="account-form"><label for="cloud-new-password">${cloud.invited?'首次使用，请设置登录密码':'修改密码'}</label><input id="cloud-new-password" type="password" minlength="6" maxlength="72" required autocomplete="new-password" autocapitalize="none" placeholder="至少 6 个字符，区分大小写"><button class="secondary-button" type="submit">保存密码</button></form>`;
    }else{
      section.innerHTML='<div class="account-tabs" role="tablist" aria-label="账号操作"><button type="button" role="tab" id="account-tab-login" aria-controls="account-pane">登录</button><button type="button" role="tab" id="account-tab-register" aria-controls="account-pane">注册</button><button type="button" role="tab" id="account-tab-forgot" aria-controls="account-pane">找回密码</button></div><div id="account-pane" role="tabpanel"></div>';
    }
    const notice=document.createElement('p');notice.className='account-notice';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');section.append(notice);$('panel-content').append(section);
    let busy=false;
    async function action(fn){
      if(busy)return;busy=true;sessionOperations++;section.querySelectorAll('button').forEach(b=>b.disabled=true);notice.textContent='正在处理…';
      try{await fn();}catch(error){notice.textContent=error.message||'操作失败，请稍后重试。';}
      finally{busy=false;sessionOperations--;section.querySelectorAll('button').forEach(b=>b.disabled=false);}
    }
    if(database.cloud){
      $('cloud-refresh').onclick=()=>action(async()=>{state=core.validate(await database.sync());render();notice.textContent=database.status==='saved'?'云端记录已更新。':'仍有待同步记录，请重试或导出。';});
      $('cloud-logout').onclick=()=>action(async()=>{await database.logout();location.reload();});
      $('cloud-password-form').onsubmit=e=>{e.preventDefault();const field=$('cloud-new-password');void action(async()=>{
        try{if([...field.value].length<6)throw Error('密码至少需要 6 个字符。');if(new TextEncoder().encode(field.value).length>72)throw Error('密码过长，请缩短后重试。');const {error}=await cloud.client.auth.updateUser({password:field.value});if(error)throw Error('密码未更新，请检查网络后重试。');notice.textContent='密码已更新，区分大小写。';}finally{field.value='';}
      });};
    }else{
      function select(tab,retainedName='',success=''){
        if(busy)return;
        section.querySelectorAll('[role="tab"]').forEach(button=>{const selected=button.id==='account-tab-'+tab;button.setAttribute('aria-selected',selected);button.tabIndex=selected?0:-1;});
        const pane=$('account-pane');pane.setAttribute('aria-labelledby','account-tab-'+tab);notice.textContent=success;
        if(tab==='forgot'){pane.innerHTML='<p class="account-help">找回密码暂未开放。忘记密码请联系管理员协助重置。</p>';return;}
        const registering=tab==='register';
        pane.innerHTML=`<p class="account-help">${registering?'注册需管理员提供的一次性激活码，已有账号登录不需要。账号和密码区分大小写，密码至少 6 个字符。':'用你的阅读账号接着读，账号和密码都区分大小写。'}</p><form id="account-form" class="account-form"><label for="account-username">账号</label><input id="account-username" type="text" required maxlength="64" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"><label for="account-password">密码</label><input id="account-password" type="password" required minlength="6" maxlength="72" autocomplete="${registering?'new-password':'current-password'}" autocapitalize="none">${registering?'<label for="account-confirm-password">确认密码</label><input id="account-confirm-password" type="password" required minlength="6" maxlength="72" autocomplete="new-password" autocapitalize="none"><label for="account-activation-code">激活码</label><input id="account-activation-code" type="text" required maxlength="64" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="粘贴管理员提供的完整激活码">':''}<button class="primary-button" type="submit">${registering?'注册':'登录'}</button></form>`;
        $('account-username').value=retainedName;
        $('account-form').onsubmit=e=>{
          e.preventDefault();const accountName=$('account-username').value,password=$('account-password'),confirmation=$('account-confirm-password');
          void action(async()=>{
            try{
              if(!registering&&database.pending)throw Error('访客记录尚未保存，请先在设置中重试或导出。');
              if(cloud.mode==='username')await cloud.account(tab,accountName,password.value,confirmation?.value,$('account-activation-code')?.value);
              else{
                if(registering)throw Error('此版本使用邀请制，请联系管理员。');
                if(!cloud.persistent)throw Error('请允许此网站保存登录状态后再登录。');
                const {error}=await cloud.client.auth.signInWithPassword({email:accountName,password:password.value});if(error)throw Error('登录失败，请检查账号、密码或网络。');
              }
              if(registering){busy=false;select('login',accountName,'注册成功，请登录。');}
              else location.reload();
            }finally{password.value='';if(confirmation)confirmation.value='';}
          });
        };
      }
      section.querySelectorAll('[role="tab"]').forEach(button=>{
        button.onclick=()=>select(button.id.replace('account-tab-',''),$('account-username')?.value||'');
        button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||busy)return;event.preventDefault();const tabs=[...section.querySelectorAll('[role="tab"]')],index=tabs.indexOf(button);const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;tabs[next].click();tabs[next].focus();};
      });
      select(mode,username,message);
    }
    if(!cloud.persistent)notice.textContent='请允许此网站保存登录状态，或换一个浏览器再登录。';
    if(!panelDialog.open)modal(panelDialog);
  }
  if(isBrowser&&window.ReaderCloud&&$('account')){
    $('account').hidden=false;$('account').textContent=database.cloud?'账号':'登录';$('account').onclick=()=>accountPanel();
  }
  $('settings').onclick=settings;
  render();if(isBrowser)LocalDB.warm?.(data.id);if(initialNotice)toast(initialNotice);if(database?.cloud&&window.ReaderCloud?.invited)accountPanel();
})();
