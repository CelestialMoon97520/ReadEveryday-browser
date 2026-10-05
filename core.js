/* 无网络依赖；这些纯函数也用于校验导入进度和词库完整性。 */
(function(root){
  'use strict';
  const normalize = value => String(value).toLowerCase().replace(/[‘’]/g,"'");
  const tokenize = text => text.match(/\$\d+(?:\.\d+)?[a-z]*|\d+(?:st|nd|rd|th)?(?:-[A-Za-z]+)*|[A-Z](?:\.[A-Z])+\.?|[A-Za-z]+(?:['’\-][A-Za-z]+)*['’]?|[^A-Za-z\d$]+|\$/g) || [];
  const isWord = text => /^[A-Za-z\d$]/.test(text);
  const dayKey = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function create(data){
    const words = Object.fromEntries(Object.entries(data.words).map(([k,v])=>[normalize(k),v]));
    const aliases = Object.fromEntries(Object.entries(data.aliases).map(([k,v])=>[normalize(k),normalize(v)]));
    const n=data.sentences.length;
    const validIndex=i=>Number.isInteger(i)&&i>=0&&i<n;
    function lookup(token,index){
      const key=normalize(token), entry=words[aliases[key]||key];
      if(!entry) return null;
      const override=Object.entries(data.sentences[index]?.overrides||{}).find(([k])=>normalize(k)===key)?.[1];
      const result={...entry,display:token,kind:'word'};
      if(override){result.pos=override[0];result.meaning=override[1];result.other=[entry.meaning,...entry.other].filter(s=>!override[1].includes(s));
        // An optional example pair belongs to this sentence only; keep saved keys stable.
        if(override.length===4){result.example=override[2];result.exampleZh=override[3];}
      }
      const morphology={biggest:'最高级',worse:'比较级',better:'比较级',wealthier:'比较级',happier:'比较级',jollier:'比较级',seen:'过去分词',spent:'过去式／过去分词',emerged:'过去式',turned:'过去分词',consumed:'过去分词',was:'过去式',is:'第三人称单数',are:'复数／第二人称形式'};
      result.form=morphology[key]||(key.endsWith('ing')&&aliases[key]?'现在分词／动名词':aliases[key]?'原形见上':'');
      return result;
    }
    function blank(){return {version:1,articleId:data.id,index:0,read:[],days:{},saved:[],large:false};}
    function validate(raw){
      if(!raw||raw.version!==1||raw.articleId!==data.id||!validIndex(raw.index)||!Array.isArray(raw.read)||!Array.isArray(raw.saved)||typeof raw.days!=='object'||!raw.days) throw Error('不是本项目的有效进度文件');
      if(raw.read.some(i=>!validIndex(i))||raw.saved.length>3000) throw Error('进度数据无效');
      const state=blank();state.index=raw.index;state.read=[...new Set(raw.read)];state.large=raw.large===true;
      for(const [day,items] of Object.entries(raw.days)){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Array.isArray(items)||items.some(i=>!validIndex(i))) throw Error('每日记录无效');
        state.days[day]=[...new Set(items)];
      }
      for(const item of raw.saved){
        if(!item||!validIndex(item.sentence)||!['word','phrase'].includes(item.kind)||typeof item.key!=='string')throw Error('词本记录无效');
        if(item.kind==='word'?!lookup(item.key,item.sentence):!Object.hasOwn(data.phrases,item.key))throw Error('未知词条');
        if(!state.saved.some(v=>v.key===item.key&&v.kind===item.kind&&v.sentence===item.sentence))state.saved.push({key:item.key,kind:item.kind,sentence:item.sentence});
      }
      // 逐日完成记录也计入总进度。
      state.read=[...new Set([...state.read,...Object.values(state.days).flat()])];return state;
    }
    function merge(current,incoming){
      const a=validate(current),b=validate(incoming);const days={...a.days};
      for(const [day,list] of Object.entries(b.days))days[day]=[...new Set([...(days[day]||[]),...list])];
      return validate({...a,index:b.index,read:[...a.read,...b.read],saved:[...a.saved,...b.saved],days});
    }
    return {lookup,blank,validate,merge,validIndex};
  }
  root.ReadCore={create,tokenize,isWord,normalize,dayKey};
})(globalThis);
