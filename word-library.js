/* Only per-word text is fetched. No audio, book images, or full dictionary UI. */
(function(root){
  'use strict';
  let revision=0,request=null;
  function stop(){revision++;request?.abort();request=null;}
  const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  async function mount(container,article,index,word){
    stop();const own=revision,lemma=container.querySelector('.lemma');
    const status=node('p','word-library-status','正在读取词卡…');lemma.after(status);request=new AbortController();
    try{
      let value;
      if(root.LocalDB?.wordCard)value=await root.LocalDB.wordCard(article,index,word);
      else{
        const r=await fetch('/api/word-card?'+new URLSearchParams({article,sentence:String(index),word}),{signal:request.signal});
        if(!r.ok)throw Error('词卡暂时无法读取。');
        value=await r.json();
      }
      if(own!==revision||!container.isConnected)return;
      if(value.source!=='ecdict')throw Error('词卡服务尚未更新，请刷新后重试。');
      if(value.status!=='ready'){status.textContent=value.note;return;}
      if(['person','place','entity'].includes(value.displayType)){
        container.querySelector('h2').textContent=value.lemma;
        container.querySelector('.pos').textContent=value.displayLabel;
        lemma.hidden=true;status.remove();
        for(const n of container.querySelectorAll('.sense-label,.meaning,.usage,.example'))n.hidden=true;
        return;
      }
      if(value.displayType==='phrase'){
        container.querySelector('h2').textContent=value.lemma;
        container.querySelector('.pos').textContent='词组';
        lemma.hidden=true;status.remove();
        return;
      }
      lemma.textContent='原形 '+value.lemma+(value.form?' · '+value.form:'');
      if(value.displayType==='number'){status.remove();}
      else if(value.phonetic){status.className='card-phonetic';status.textContent='原形音标 /'+value.phonetic+'/';status.setAttribute('title','音标来源：'+value.phoneticSource);}
      else{status.textContent='音标暂缺';}
      if(value.root&&value.displayType!=='number'){
        const card=node('section','card-memory');card.append(node('h3','','词根词缀 · 构词助记'),node('b','',value.root.parts),node('p','',value.root.meaning));
        if(value.root.note)card.append(node('small','',value.root.note));
        container.querySelector('.example').before(card);
      }
    }catch(error){if(own===revision&&error.name!=='AbortError')status.textContent=error.message;}
  }
  root.ReadWordLibrary={mount,stop};root.addEventListener('pagehide',stop);
})(globalThis);
