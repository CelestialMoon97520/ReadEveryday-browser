/* Account storage only; articles and word cards still use the shared static corpus. */
(function(root){
  'use strict';
  const config=root.READEVERYDAY_CLOUD;
  if(!config||!root.ReaderSupabase)return;
  const clone=value=>JSON.parse(JSON.stringify(value)),memory=new Map();
  let persistent=true,activeOwner=null,boundSession=null,bindFlight=null,revoked=false;
  const storage={
    getItem(key){try{return localStorage.getItem(key);}catch{persistent=false;return memory.get(key)??null;}},
    setItem(key,value){memory.set(key,value);try{localStorage.setItem(key,value);}catch{persistent=false;}},
    removeItem(key){memory.delete(key);try{localStorage.removeItem(key);}catch{persistent=false;}}
  };
  try{const probe='read-everyday-auth-probe:'+Date.now()+':'+Math.random();localStorage.setItem(probe,'1');localStorage.removeItem(probe);}
  catch{persistent=false;}
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
  async function browserKey(){
    const load=()=>{
      const name='read-everyday-browser-key-v1';let key=storage.getItem(name);
      if(!/^[0-9a-f]{64}$/.test(key||'')){key=[...root.crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');storage.setItem(name,key);}
      if(!persistent)throw Error('请允许此网站保存登录状态后再登录。');return key;
    };
    return root.navigator?.locks?root.navigator.locks.request('read-everyday-browser-key-v1',load):load();
  }
  function browserLabel(){
    const agent=root.navigator?.userAgent||'';
    const platform=/iPad|Tablet/i.test(agent)?'平板':/Android|iPhone|Mobile/i.test(agent)?'手机':/Windows|Macintosh|Linux/i.test(agent)?'电脑':'浏览器';
    const browser=/VivoBrowser/i.test(agent)?'vivo 浏览器':/Edg/i.test(agent)?'Edge':/Firefox/i.test(agent)?'Firefox':/Chrome|CriOS/i.test(agent)?'Chrome':/Safari/i.test(agent)?'Safari':'浏览器';
    return platform+' · '+browser;
  }
  async function devices(action='list',target){
    const {data,error}=await client.rpc('reader_devices',{p_action:action,...(target?{p_target:target}:{}),
      ...(action==='bind'?{p_browser_key:await browserKey(),p_label:browserLabel()}:{} )});
    if(error)throw Error('登录设备暂时无法读取，请检查网络后重试。');
    if(data?.status==='revoked'){revoked=true;throw Error('此浏览器登录已下线，请重新登录；未同步记录仍保留。');}
    if(data?.status!=='ok')throw Error('设备管理失败，请稍后重试。');return data;
  }
  async function identity(){
    const {data,error}=await client.auth.getSession();if(error)throw Error('账户连接失败');
    const session=data.session;if(!session?.user)return null;
    let id;try{id=JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id;}catch{id=session.user.id;}
    if(boundSession!==id){
      bindFlight??=devices(persistent?'bind':'list').then(()=>{boundSession=id;revoked=false;}).finally(()=>{bindFlight=null;});
      try{await bindFlight;}catch(error){if(revoked)return null;throw error;}
    }
    return session.user;
  }
  async function manageDevices(managementToken,operation='list',target){
    let response,value;try{
      response=await fetch(config.url+'/functions/v1/reader-account',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey},
        body:JSON.stringify({action:'manage',managementToken,operation,...(target?{target}:{} )}),signal:AbortSignal.timeout(25000)});
      value=await response.json();
    }catch{throw Error('设备管理连接失败，请检查网络后重试。');}
    if(!response.ok)throw Error(value.message||'设备管理失败，请重新登录验证。');return value;
  }
  let turnstileLoading;
  async function mountCaptcha(container,action){
    const response=await fetch(config.url+'/functions/v1/reader-account',{headers:{apikey:config.publishableKey},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('安全验证暂时无法加载，请稍后重新打开登录窗口。');
    const meta=await response.json();if(!meta.captcha){container.hidden=true;return {token:undefined,dispose(){},reset(){}};}
    if(meta.captcha.provider!=='turnstile'||!meta.captcha.siteKey)throw Error('安全验证配置不可用，请稍后重试。');
    if(!root.turnstile){
      turnstileLoading??=new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
        const timeout=setTimeout(()=>{script.remove();turnstileLoading=null;reject(Error('安全验证加载超时，请检查网络后重试。'));},15000);
        script.onload=()=>{clearTimeout(timeout);resolve();};script.onerror=()=>{clearTimeout(timeout);script.remove();turnstileLoading=null;reject(Error('安全验证无法加载，请检查网络后重试。'));};
        document.head.append(script);
      });
      await turnstileLoading;
    }
    if(!container.isConnected)return {dispose(){},reset(){}};
    let token='',disposed=false;
    container.textContent='';
    const widget=root.turnstile.render(container,{sitekey:meta.captcha.siteKey,action,theme:'auto',size:'compact',language:'zh-cn',
      callback:value=>{if(!disposed)token=value;},'expired-callback':()=>{token='';},'error-callback':()=>{token='';}});
    return {get token(){if(!token)throw Error('请等待安全验证完成，再提交。');return token;},
      reset(){if(!disposed){token='';root.turnstile.reset(widget);}},dispose(){if(!disposed){disposed=true;token='';root.turnstile.remove(widget);}}};
  }
  async function account(action,username,password,confirmPassword,activationCode,captchaToken){
    if(!persistent)throw Error('此浏览器禁止网站存储，请允许此网站保存登录状态，或换一个浏览器再登录。');
    if(typeof username!=='string'||!username||[...username].length>64||username!==username.trim()||/[\u0000-\u001f\u007f]/.test(username))
      throw Error('账号需要 1–64 个字符，首尾不能有空格。');
    if(typeof password!=='string'||[...password].length<6)throw Error('密码至少需要 6 个字符，区分大小写。');
    if(new TextEncoder().encode(password).length>72)throw Error('密码过长，请缩短后重试。');
    if(action==='register'&&password!==confirmPassword)throw Error('两次输入的密码不一致。');
    const code=typeof activationCode==='string'?activationCode.trim().toUpperCase():'';
    if(action==='register'&&!/^RD-(?:[A-Z2-7]{4}-){7}[A-Z2-7]{4}$/.test(code))throw Error('注册需要有效的激活码，请向管理员领取。');
    let response,value;
    try{response=await fetch(config.url+'/functions/v1/reader-account',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey},
      body:JSON.stringify({action,username,password,...(action==='login'?{browserKey:await browserKey()}:{}),...(action==='register'?{confirmPassword,activationCode:code}:{} ),...(captchaToken?{captchaToken}:{})}),signal:AbortSignal.timeout(25000)});value=await response.json();}
    catch{throw Error('连接失败，请检查网络后重试。');}
    if(!response.ok){const error=Error(value.message||'账号操作失败，请稍后重试。');if(value.code==='device_limit')error.deviceLimit=value;throw error;}
    if(action==='login'){
      if(!value.session?.access_token||!value.session?.refresh_token)throw Error('登录未完成，请稍后重试。');
      const {error}=await client.auth.setSession(value.session);if(error)throw Error('登录状态未保存，请稍后重试。');boundSession=null;revoked=false;
    }
    return value;
  }
  async function open(data,core,list,user){
    activeOwner=user.id;
    const key='read-everyday-cloud-v1:'+user.id+':'+data.id;
    let state=core.blank(),base=core.blank(),revision=0,pending=false,status='checking',cacheOK=true,listener=()=>{},blocked=false,sessionRevoked=false,flight=null,refreshFlight=null,timer,disposed=false,retryAt=0;
    const cached=storage.getItem(key);
    if(cached){
      try{const record=JSON.parse(cached);if(record.version!==1||!Number.isSafeInteger(record.revision)||record.revision<0)throw Error();
        state=core.validate(record.state);base=core.validate(record.base);revision=record.revision;pending=record.pending===true;
        if(pending)status='pending';
      }catch{throw Error('此账号的浏览器副本无法读取，请保留数据并导出备份。');}
    }
    function writeCache(){
      try{localStorage.setItem(key,JSON.stringify({version:1,state,base,revision,pending,updatedAt:new Date().toISOString()}));cacheOK=true;}
      catch{cacheOK=false;}
    }
    function report(value,changed=false){status=value;listener(value,cacheOK,changed?clone(state):undefined);}
    const blockedStatus=()=>sessionRevoked?'revoked':blocked?'conflict':'error';
    async function guard(){
      if((await identity())?.id!==user.id){blocked=true;throw Error('账户已切换，请先导出此页的未同步记录。');}
      const {data:active,error}=await client.rpc('reader_session_active');
      if(error)throw Error('登录状态暂时无法核对。');
      if(active!==true){sessionRevoked=true;revoked=true;blocked=true;report('revoked');throw Error('此浏览器登录已下线，请重新登录；未同步记录仍保留。');}
    }
    async function load(){
      await guard();
      const {data:rows,error}=await client.from('reader_progress').select('state,revision,updated_at').eq('article_id',data.id).eq('user_id',user.id);
      if(error)throw Error('云端读取失败');await guard();
      const row=rows[0];return row?{...row,state:core.validate(row.state)}:{state:core.blank(),revision:0};
    }
    async function refresh(){
      if(refreshFlight)return refreshFlight;
      // Serialize reads with writes. Merge against the server base, including edits
      // made after cached progress was rendered and while this read was in flight.
      refreshFlight=(async()=>{
        if(flight)await flight;
        const before=clone(base),remote=await load();await guard();
        if(disposed)return;
        if(blocked)throw Error('浏览器记录有变化，请先重试或导出。');
        state=pending?merge(core,before,state,remote.state):remote.state;
        base=clone(remote.state);revision=remote.revision;
        pending=JSON.stringify(state)!==JSON.stringify(remote.state);writeCache();report(pending?'pending':'saved',true);
      })();
      try{await refreshFlight;}finally{refreshFlight=null;}
    }
    function cachedRows(){
      const rows=[];
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);if(!k?.startsWith('read-everyday-cloud-v1:'+user.id+':'))continue;
        const record=JSON.parse(localStorage.getItem(k)),s=record.state;
        if(!list.some(a=>a.id===s?.articleId)||k!==('read-everyday-cloud-v1:'+user.id+':'+s.articleId))continue;
        if(!Array.isArray(s.read)||!s.days||!Number.isInteger(s.index))throw Error('账号历史副本无法读取，请保留备份。');
        rows.push({article_id:s.articleId,state:s,updated_at:record.updatedAt||'',pending:record.pending});
      }
      return rows;
    }
    function summarize(rows){
      const articles=[],days=[];
      for(const row of rows){const meta=list.find(a=>a.id===row.article_id);if(!meta)continue;
        articles.push({articleId:meta.id,title:meta.title,source:meta.source,index:row.state.index,readCount:row.state.read.length,updatedAt:row.updated_at});
        for(const [day,items] of Object.entries(row.state.days))days.push({articleId:meta.id,day,count:items.length});
      }
      articles.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));days.sort((a,b)=>b.day.localeCompare(a.day));return {articles,days};
    }
    const session={kind:'browser',cloud:true,user,data,key,
      get state(){return state;},get pending(){return pending;},get status(){return status;},
      subscribe(fn){listener=fn;fn(status,cacheOK);},
      dispose(options={}){
        if(pending&&(!options.preservePending||!cacheOK))throw Error('还有未同步记录，请先重试或导出。');
        disposed=true;clearTimeout(timer);listener=()=>{};
        for(const [event,fn] of Object.entries(handlers))root.removeEventListener(event,fn);
        authSubscription?.data?.subscription?.unsubscribe();
      },
      save(value){if(disposed)return;state=core.validate(clone(value));pending=true;writeCache();report(blocked?blockedStatus():'pending');clearTimeout(timer);timer=setTimeout(()=>void flush(),250);},
      async retry(){if(blocked){await guard();blocked=false;}pending=true;await flush();return clone(state);},
      async sync(){if(pending)await flush();else await refresh();if(pending)await flush();return clone(state);},
      async catalog(){return list.map(({file,...meta})=>meta);},
      async history(options={}){
        if(options.cached)return summarize(cachedRows());
        await guard();const {data:rows,error}=await client.from('reader_progress').select('article_id,state,updated_at').eq('user_id',user.id);
        if(error)throw Error('云端历史读取失败');await guard();
        const combined=new Map(rows.map(row=>[row.article_id,row]));
        for(const row of cachedRows())if(row.pending)combined.set(row.article_id,row);
        return summarize([...combined.values()]);
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
      clearTimeout(timer);if(refreshFlight){try{await refreshFlight;}catch{}}
      if(disposed)return;if(flight)return flight;if(blocked){report(blockedStatus());return;}
      if(Date.now()<retryAt){report('limited');timer=setTimeout(()=>void flush(),retryAt-Date.now()+100);return;}
      flight=(async()=>{
        try{
          for(let attempt=0;pending&&!disposed&&attempt<8;attempt++){
            await guard();if(disposed)return;const sent=clone(state),sentBase=clone(base),expected=revision;report('saving');
            const {data:reply,error}=await client.rpc('save_reader_progress',{p_article_id:data.id,p_expected_revision:expected,p_state:sent});
            if(disposed)return;
            if(reply?.status==='revoked'){sessionRevoked=true;revoked=true;blocked=true;writeCache();report('revoked');return;}
            if((error?.code==='P0001'&&error.message==='READER_STORAGE_QUOTA_EXCEEDED')||reply?.status==='quota_exceeded'){writeCache();report('quota');return;}
            if(!error&&['rate_limited','paused'].includes(reply?.status)){
              retryAt=Date.now()+Math.min(300,Math.max(1,Number(reply.retry_after)||60))*1000;
              writeCache();report(reply.status==='paused'?'paused':'limited');timer=setTimeout(()=>void flush(),retryAt-Date.now()+100);return;
            }
            if(error||!reply||!['saved','conflict'].includes(reply.status))throw Error('云端保存失败');
            if(reply.status==='conflict'){
              const remote=reply.row?core.validate(reply.row.state):core.blank();
              state=merge(core,sentBase,state,remote);base=clone(remote);revision=reply.row?.revision||0;writeCache();report('pending',true);continue;
            }
            const remote=core.validate(reply.row.state);base=clone(remote);revision=reply.row.revision;
            pending=JSON.stringify(state)!==JSON.stringify(sent);writeCache();report(pending?'pending':'saved');
          }
          if(pending)report('conflict');
        }catch{if(!disposed){writeCache();report(blockedStatus());}}
      })();
      try{await flight;}finally{flight=null;}
    }
    const handlers={
      online:()=>{if(pending)void flush();else void session.sync().catch(()=>report(blockedStatus()));},
      focus:()=>{if(!pending&&!blocked)void session.sync().catch(()=>report(blockedStatus()));},
      beforeunload:event=>{if(pending){event.preventDefault();event.returnValue='';}},
      storage:event=>{if(event.key===key||event.key===null){blocked=true;report('conflict');}}
    };
    for(const [event,fn] of Object.entries(handlers))root.addEventListener(event,fn);
    const authSubscription=client.auth.onAuthStateChange((event,auth)=>{
      if(event!=='INITIAL_SESSION'&&auth?.user?.id!==user.id){blocked=true;report('conflict');}
    });
    if(cached){
      void refresh().then(()=>{if(pending&&!blocked&&!disposed)void flush();}).catch(()=>{if(!disposed)report(blockedStatus());});
    }else{
      try{await refresh();}catch{session.dispose();throw Error('云端进度暂时无法读取，请联网后重试；不会以空记录覆盖。');}
    }
    return session;
  }
  root.ReaderCloud={client,ready,identity,open,merge,invited,mode:config.mode,account,mountCaptcha,devices,manageDevices,get revoked(){return revoked;},get persistent(){return persistent;}};
})(globalThis);
