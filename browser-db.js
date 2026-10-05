/* Static-site adapter. The reading UI and corpus remain shared with the local app. */
(function(root){
  'use strict';
  const PREFIX='read-everyday-browser-v1:',clone=value=>JSON.parse(JSON.stringify(value));
  const release=root.READEVERYDAY_RELEASE,contentPromises=new Map();
  const cachePrefix='read-everyday-content-v1:',cacheName=cachePrefix+release?.version;
  let cachePromise,prefetchTimer,prefetchFlight,warmGeneration=0;
  async function contentCache(){
    return cachePromise??=(async()=>{
      try{
        const cache=await root.caches.open(cacheName),names=(await root.caches.keys()).filter(name=>name.startsWith(cachePrefix));
        // Retain this release and the most recent other release for open tabs/rollback.
        const previous=names.filter(name=>name!==cacheName).at(-1);
        await Promise.all(names.filter(name=>name!==cacheName&&name!==previous).map(name=>root.caches.delete(name)));
        return cache;
      }catch{return null;}
    })();
  }
  async function decode(response,hash){
    if(!response.ok)throw Error('内容加载失败，请刷新后重试。');
    const bytes=await response.arrayBuffer();
    const actual=[...new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if(actual!==hash)throw Error('内容版本正在更新，请刷新网页后重试。');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function readJSON(path){
    if(!release?.files?.[path]||release.version!==root.READEVERYDAY_PAGE_VERSION)return Promise.reject(Error('内容版本缺失或正在更新，请刷新网页后重试。'));
    if(!contentPromises.has(path)){
      const promise=(async()=>{
        const hash=release.files[path],url=new URL(path,location.href);url.searchParams.set('v',hash);
        const cache=await contentCache();
        if(cache){
          try{const response=await cache.match(url.href);if(response)return await decode(response,hash);}
          catch{try{await cache.delete(url.href);}catch{}}
        }
        const response=await fetch(url,{cache:'force-cache',signal:AbortSignal.timeout(15000)});
        const value=await decode(response.clone(),hash);
        try{if(cache)await cache.put(url.href,response);}catch{}
        return value;
      })();
      contentPromises.set(path,promise);promise.catch(()=>contentPromises.delete(path));
    }
    return contentPromises.get(path);
  }
  const catalog=()=>readJSON('content/catalog.json');
  const articlePath=id=>'content/articles/'+encodeURIComponent(id)+'.json';
  const cardsPath=id=>'content/cards/'+encodeURIComponent(id)+'.json';
  async function prefetch(id,cards=false){
    if(!release?.files?.[articlePath(id)])return;
    if(prefetchFlight)return prefetchFlight;
    prefetchFlight=Promise.allSettled([readJSON(articlePath(id)),...(cards?[readJSON(cardsPath(id))]:[])]);
    try{await prefetchFlight;}finally{prefetchFlight=null;}
  }
  function warm(id){
    clearTimeout(prefetchTimer);const generation=++warmGeneration;
    const connection=root.navigator?.connection;
    if(connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType))return;
    prefetchTimer=setTimeout(async()=>{
      const list=await catalog().catch(()=>[]),next=list[list.findIndex(a=>a.id===id)+1];
      await prefetch(id,true);if(next&&generation===warmGeneration)await prefetch(next.id,true);
    },800);
  }
  function readRecord(article){
    const raw=localStorage.getItem(PREFIX+article.id);
    if(raw===null)return null;
    const record=JSON.parse(raw);
    if(record.version!==1||!Number.isInteger(record.revision)||record.revision<1||typeof record.updatedAt!=='string')throw Error('浏览器记录格式无效，请先保留备份。');
    return {...record,state:ReadCore.create(article).validate(record.state)};
  }
  async function open(selected){
    if(location.protocol==='file:')throw Error('请打开预览网址，或通过本地 HTTP 服务预览此文件夹。');
    const id=selected||new URLSearchParams(location.search).get('article')||release?.defaultArticle;
    const [list,data]=await Promise.all([catalog(),readJSON(articlePath(id))]);
    if(!list.some(a=>a.id===id))throw Error('这篇文章不在当前题库中，请从首页重新选择。');
    const core=ReadCore.create(data);
    if(root.ReaderCloud){await root.ReaderCloud.ready;const user=await root.ReaderCloud.identity();if(user)return root.ReaderCloud.open(data,core,list,user);}
    let current=null,storageOK=true;
    try{current=readRecord(data);}catch(error){
      if(error instanceof SyntaxError||/格式|进度|记录|词条/.test(error.message))throw Error('已有阅读记录无法读取，请保留浏览器数据并检查备份。');
      storageOK=false;
    }
    let state=current?.state||core.blank(),revision=current?.revision||0,pending=false,blocked=false;
    let status=storageOK?'saved':'error',listener=()=>{},disposed=false;
    function report(value){status=value;listener(value,storageOK);}
    function flush(){
      if(blocked)return;
      try{
        const latest=readRecord(data);
        if((latest?.revision||0)!==revision){blocked=true;pending=true;report('conflict');return;}
        const record={version:1,revision:revision+1,state:clone(state),updatedAt:new Date().toISOString()};
        localStorage.setItem(PREFIX+id,JSON.stringify(record));
        revision=record.revision;storageOK=true;pending=false;report('saved');
      }catch{storageOK=false;pending=true;report('error');}
    }
    const session={kind:'browser',data,state,key:PREFIX+id,
      get pending(){return pending;},get status(){return status;},
      subscribe(fn){listener=fn;fn(status,storageOK);},
      dispose(){if(pending)throw Error('还有未保存记录，请先重试或导出。');disposed=true;listener=()=>{};root.removeEventListener('storage',onStorage);root.removeEventListener('beforeunload',onUnload);},
      save(value){if(disposed)return;state=core.validate(clone(value));session.state=state;pending=true;if(blocked)report('conflict');else flush();},
      async retry(){
        if(blocked){
          const latest=readRecord(data);
          state=latest?core.merge(latest.state,state):state;
          revision=latest?.revision||0;session.state=state;blocked=false;
        }
        pending=true;flush();return session.state;
      },
      async catalog(){return (await catalog()).map(({file,...metadata})=>metadata);},
      async history(){
        const articles=[],days=[];
        for(const article of await catalog()){
          const raw=localStorage.getItem(PREFIX+article.id);
          if(raw===null)continue;
          const record=JSON.parse(raw),saved=record.state;
          if(saved?.articleId!==article.id||!Array.isArray(saved.read)||!Number.isInteger(saved.index)||!saved.days)throw Error('阅读历史记录无效，请检查备份。');
          articles.push({articleId:article.id,title:article.title,source:article.source,index:saved.index,readCount:saved.read.length,updatedAt:record.updatedAt});
          for(const [day,items] of Object.entries(saved.days))days.push({articleId:article.id,day,count:items.length});
        }
        articles.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
        days.sort((a,b)=>b.day.localeCompare(a.day)||a.articleId.localeCompare(b.articleId));
        return {articles,days};
      }
    };
    function onStorage(event){if(event.key===PREFIX+id||event.key===null){blocked=true;report('conflict');}}
    function onUnload(event){if(pending){event.preventDefault();event.returnValue='';}}
    root.addEventListener('storage',onStorage);root.addEventListener('beforeunload',onUnload);
    return session;
  }
  async function wordCard(article,index,word){
    const list=await catalog();
    if(!list.some(a=>a.id===article))throw Error('未知文章');
    const cards=await readJSON(cardsPath(article)),token=ReadCore.normalize(word);
    return cards[index+':'+token]||{status:'pending',source:'ecdict',note:'音标资料暂缺，本文词义与例句仍可查看。'};
  }
  root.LocalDB={open,wordCard,prefetch,warm};
})(globalThis);
