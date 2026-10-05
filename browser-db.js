/* Static-site adapter. The reading UI and corpus remain shared with the local app. */
(function(root){
  'use strict';
  const PREFIX='read-everyday-browser-v1:',clone=value=>JSON.parse(JSON.stringify(value));
  let catalogPromise;
  const cardPromises=new Map();
  async function readJSON(path){
    const response=await fetch(new URL(path,location.href),{cache:'no-cache'});
    if(!response.ok)throw Error('内容加载失败，请刷新后重试。');
    return response.json();
  }
  function catalog(){return catalogPromise??=readJSON('content/catalog.json');}
  function readRecord(article){
    const raw=localStorage.getItem(PREFIX+article.id);
    if(raw===null)return null;
    const record=JSON.parse(raw);
    if(record.version!==1||!Number.isInteger(record.revision)||record.revision<1||typeof record.updatedAt!=='string')throw Error('浏览器记录格式无效，请先保留备份。');
    return {...record,state:ReadCore.create(article).validate(record.state)};
  }
  async function open(){
    if(location.protocol==='file:')throw Error('请打开预览网址，或通过本地 HTTP 服务预览此文件夹。');
    const list=await catalog(),id=new URLSearchParams(location.search).get('article')||list[0]?.id;
    if(!list.some(a=>a.id===id))throw Error('这篇文章不在当前题库中，请从首页重新选择。');
    const data=await readJSON('content/articles/'+encodeURIComponent(id)+'.json'),core=ReadCore.create(data);
    if(root.ReaderCloud){await root.ReaderCloud.ready;const user=await root.ReaderCloud.identity();if(user)return root.ReaderCloud.open(data,core,list,user);}
    let current=null,storageOK=true;
    try{current=readRecord(data);}catch(error){
      if(error instanceof SyntaxError||/格式|进度|记录|词条/.test(error.message))throw Error('已有阅读记录无法读取，请保留浏览器数据并检查备份。');
      storageOK=false;
    }
    let state=current?.state||core.blank(),revision=current?.revision||0,pending=false,blocked=false;
    let status=storageOK?'saved':'error',listener=()=>{};
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
      save(value){state=core.validate(clone(value));session.state=state;pending=true;if(blocked)report('conflict');else flush();},
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
    root.addEventListener('storage',event=>{if(event.key===PREFIX+id||event.key===null){blocked=true;report('conflict');}});
    root.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
    return session;
  }
  async function wordCard(article,index,word){
    const list=await catalog();
    if(!list.some(a=>a.id===article))throw Error('未知文章');
    if(!cardPromises.has(article)){
      const promise=readJSON('content/cards/'+encodeURIComponent(article)+'.json');
      cardPromises.set(article,promise);
      promise.catch(()=>cardPromises.delete(article));
    }
    const cards=await cardPromises.get(article),token=ReadCore.normalize(word);
    return cards[index+':'+token]||{status:'pending',source:'ecdict',note:'音标资料暂缺，本文词义与例句仍可查看。'};
  }
  root.LocalDB={open,wordCard};
})(globalThis);
