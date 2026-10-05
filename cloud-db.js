/* Account storage only; articles and word cards still use the shared static corpus. */
(function(root){
  'use strict';
  const config=root.READEVERYDAY_CLOUD;
  if(!config||!root.ReaderSupabase)return;
  const clone=value=>JSON.parse(JSON.stringify(value)),memory=new Map();
  let persistent=true,activeOwner=null;
  const storage={
    getItem(key){try{return localStorage.getItem(key);}catch{persistent=false;return memory.get(key)??null;}},
    setItem(key,value){memory.set(key,value);try{localStorage.setItem(key,value);}catch{persistent=false;}},
    removeItem(key){memory.delete(key);try{localStorage.removeItem(key);}catch{persistent=false;}}
  };
  const invited=new URLSearchParams(location.hash.slice(1)).get('type')==='invite';
  const client=root.ReaderSupabase.createClient(config.url,config.publishableKey,{auth:{storage},global:{
    fetch:(url,options={})=>{
      if(activeOwner&&String(url).includes('/rest/v1/')){
        const token=new Headers(options.headers).get('Authorization')?.replace(/^Bearer /,'');
        let owner;try{owner=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}
        if(owner!==activeOwner)throw Error('账户已切换；本页记录不会写入另一个账号。');
      }
      return fetch(url,{...options,signal:options.signal||AbortSignal.timeout(12000)});
    }
  }});
  const ready=client.auth.getSession().then(({data,error})=>{if(error)throw Error('账户暂时无法连接，请联网后刷新；已有数据仍保留。');return data.session;});
  const savedKey=item=>JSON.stringify([item.kind,item.key,item.sentence]);
  // Three-way merge respects deletions on either device while retaining new favorites.
  // Completed sentences are cumulative; cursor/font change only if this device changed them.
  function merge(core,base,local,remote){
    base=core.validate(base);local=core.validate(local);remote=core.validate(remote);
    const a=new Map(base.saved.map(v=>[savedKey(v),v])),b=new Map(local.saved.map(v=>[savedKey(v),v])),c=new Map(remote.saved.map(v=>[savedKey(v),v]));
    const saved=[...new Map([...b,...c]).entries()].filter(([key])=>!a.has(key)||(b.has(key)&&c.has(key))).map(([,v])=>v);
    return core.validate({...core.merge(remote,local),saved,index:local.index!==base.index?local.index:remote.index,large:local.large!==base.large?local.large:remote.large});
  }
  async function identity(){const {data,error}=await client.auth.getSession();if(error)throw Error('账户连接失败');return data.session?.user||null;}
  async function open(data,core,list,user){
    activeOwner=user.id;
    const key='read-everyday-cloud-v1:'+user.id+':'+data.id;
    let state=core.blank(),base=core.blank(),revision=0,pending=false,status='saved',cacheOK=true,listener=()=>{},blocked=false,flight=null,timer;
    const cached=storage.getItem(key);
    if(cached){
      try{const record=JSON.parse(cached);if(record.version!==1||!Number.isSafeInteger(record.revision)||record.revision<0)throw Error();
        state=core.validate(record.state);base=core.validate(record.base);revision=record.revision;pending=record.pending===true;
      }catch{throw Error('此账号的浏览器副本无法读取，请保留数据并导出备份。');}
    }
    function writeCache(){
      try{localStorage.setItem(key,JSON.stringify({version:1,state,base,revision,pending,updatedAt:new Date().toISOString()}));cacheOK=true;}
      catch{cacheOK=false;}
    }
    function report(value,changed=false){status=value;listener(value,cacheOK,changed?clone(state):undefined);}
    async function guard(){if((await identity())?.id!==user.id){blocked=true;throw Error('账户已切换，请先导出此页的未同步记录。');}}
    async function load(){
      await guard();
      const {data:rows,error}=await client.from('reader_progress').select('state,revision,updated_at').eq('article_id',data.id).eq('user_id',user.id);
      if(error)throw Error('云端读取失败');
      const row=rows[0];return row?{...row,state:core.validate(row.state)}:{state:core.blank(),revision:0};
    }
    try{const remote=await load();state=pending?merge(core,base,state,remote.state):remote.state;base=clone(remote.state);revision=remote.revision;writeCache();}
    catch(error){if(!cached)throw Error('云端进度暂时无法读取，请联网后重试；不会以空记录覆盖。');status=blocked?'conflict':'error';}
    const session={kind:'browser',cloud:true,user,data,key,
      get state(){return state;},get pending(){return pending;},get status(){return status;},
      subscribe(fn){listener=fn;fn(status,cacheOK);},
      save(value){state=core.validate(clone(value));pending=true;writeCache();report(blocked?'conflict':'pending');clearTimeout(timer);timer=setTimeout(()=>void flush(),250);},
      async retry(){if(blocked){await guard();blocked=false;}pending=true;await flush();return clone(state);},
      async sync(){if(pending){await flush();return clone(state);}const before=clone(state),row=await load();
        state=pending?merge(core,before,state,row.state):row.state;base=clone(row.state);revision=row.revision;writeCache();report(pending?'pending':'saved',true);if(pending)void flush();return clone(state);},
      async catalog(){return list.map(({file,...meta})=>meta);},
      async history(){
        await guard();const {data:rows,error}=await client.from('reader_progress').select('article_id,state,updated_at').eq('user_id',user.id);
        if(error)throw Error('云端历史读取失败');
        const articles=[],days=[];
        for(const row of rows){const meta=list.find(a=>a.id===row.article_id);if(!meta)continue;
          articles.push({articleId:meta.id,title:meta.title,source:meta.source,index:row.state.index,readCount:row.state.read.length,updatedAt:row.updated_at});
          for(const [day,items] of Object.entries(row.state.days))days.push({articleId:meta.id,day,count:items.length});
        }
        articles.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));days.sort((a,b)=>b.day.localeCompare(a.day));return {articles,days};
      },
      async logout(){clearTimeout(timer);if(pending){await flush();if(pending)throw Error('还有未同步记录，请先重试或导出，再退出账号。');}
        try{
          for(let i=0;i<localStorage.length;i++){
            const k=localStorage.key(i);
            if(k?.startsWith('read-everyday-cloud-v1:'+user.id+':')&&JSON.parse(localStorage.getItem(k)).pending)
              throw Error('其他文章还有未同步记录，请先回到该文章重试或导出，再退出账号。');
          }
        }catch(error){throw Error(error.message.includes('其他文章')?error.message:'浏览器副本无法检查，请保留数据并确认其他文章已同步后再退出。');}
        const {error}=await client.auth.signOut({scope:'local'});if(error)throw Error('退出失败，请重试');
        // Remove only this account's site copies on explicit logout (shared-device privacy).
        try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k?.startsWith('read-everyday-cloud-v1:'+user.id+':'))localStorage.removeItem(k);}}catch{}
      }
    };
    async function flush(){
      clearTimeout(timer);if(flight)return flight;if(blocked){report('conflict');return;}
      flight=(async()=>{
        try{
          for(let attempt=0;pending&&attempt<8;attempt++){
            await guard();const sent=clone(state),sentBase=clone(base),expected=revision;report('saving');
            const {data:reply,error}=await client.rpc('save_reader_progress',{p_article_id:data.id,p_expected_revision:expected,p_state:sent});
            if(error||!reply||!['saved','conflict'].includes(reply.status))throw Error('云端保存失败');
            if(reply.status==='conflict'){
              const remote=reply.row?core.validate(reply.row.state):core.blank();
              state=merge(core,sentBase,state,remote);base=clone(remote);revision=reply.row?.revision||0;writeCache();report('pending',true);continue;
            }
            const remote=core.validate(reply.row.state);base=clone(remote);revision=reply.row.revision;
            pending=JSON.stringify(state)!==JSON.stringify(sent);writeCache();report(pending?'pending':'saved');
          }
          if(pending)report('conflict');
        }catch{writeCache();report(blocked?'conflict':'error');}
      })();
      try{await flight;}finally{flight=null;}
    }
    root.addEventListener('online',()=>{if(pending)void flush();else void session.sync().catch(()=>report('error'));});
    root.addEventListener('focus',()=>{if(!pending&&!blocked)void session.sync().catch(()=>report('error'));});
    root.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
    root.addEventListener('storage',event=>{if(event.key===key||event.key===null){blocked=true;report('conflict');}});
    client.auth.onAuthStateChange((event,auth)=>{
      if(event!=='INITIAL_SESSION'&&auth?.user?.id!==user.id){blocked=true;report('conflict');}
    });
    if(pending&&!blocked)timer=setTimeout(()=>void flush(),0);
    return session;
  }
  root.ReaderCloud={client,ready,identity,open,merge,invited,get persistent(){return persistent;}};
})(globalThis);
