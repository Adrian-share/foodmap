(() => {
  'use strict';
  const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),review=params.get('review')==='1';
  const dialog=$('video-dialog');let active,opener,records=[];
  function el(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;}
  function unavailable(){
    $('video-slot').replaceChildren();$('video-status').textContent='原视频暂不可播放。门店与来源信息仍保留，可稍后重试。';
    $('load-video').hidden=true;$('video-unavailable').hidden=true;$('retry-video').hidden=false;
  }
  function load(){
    if(!active)return;
    const u=new URL(active.player_url);if(u.origin!=='https://player.bilibili.com'||u.pathname!=='/player.html')return unavailable();
    const f=document.createElement('iframe');f.src=u.href;f.title=active.video.title+' · B 站官方播放器';
    f.allow='fullscreen; picture-in-picture';f.allowFullscreen=true;f.referrerPolicy='strict-origin-when-cross-origin';
    // 限制播放器将顶层页面带离本站；不开放弹窗或顶层导航。
    f.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');f.addEventListener('error',unavailable);
    $('video-slot').replaceChildren(f);$('load-video').hidden=true;$('retry-video').hidden=true;$('video-unavailable').hidden=false;
    $('video-status').textContent='已打开官方播放器，点击播放器内播放键开始。若受限，请点击“播放器无法播放”。';
  }
  function open(r,button){
    active=r;opener=button;$('video-title').textContent=r.visit?[r.visit.store_name,r.visit.branch_name].filter(Boolean).join(' · '):r.video.title;
    $('video-author').textContent=(r.creator?.name||'原视频')+' · '+r.video.bvid+' · P'+r.video.part;
    $('video-source').textContent='B 站原视频出处：'+r.video.url;
    $('video-slot').replaceChildren();$('load-video').hidden=false;$('retry-video').hidden=true;$('video-unavailable').hidden=true;
    $('video-status').textContent=r.video.playback_status==='unavailable'?'原视频暂不可播放，可重试官方播放器。':'按需打开；默认不自动播放。';
    dialog.showModal();
  }
  $('close-video').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{$('video-slot').replaceChildren();active=null;opener?.focus();});
  $('load-video').onclick=load;$('retry-video').onclick=load;$('video-unavailable').onclick=unavailable;
  function render(){
    const term=$('content-query').value.trim().toLowerCase(),found=records.filter(r=>[r.creator.name,r.video.title,r.video.bvid,r.visit.store_name,r.visit.branch_name].filter(Boolean).join(' ').toLowerCase().includes(term));
    $('cards').replaceChildren();
    for(const r of found){
      const card=el('article',null,'card');card.dataset.bvid=r.video.bvid;card.dataset.visitId=r.visit_id;card.dataset.published=String(r.published);
      if(r.published&&r.visit.screenshots.length&&!review){const i=r.visit.screenshots[0],img=el('img');img.src='/'+i.path;img.alt=i.alt;img.loading='lazy';card.append(img);}
      else{const ph=el('div',null,'placeholder');ph.append(el('strong','待补截图'),el('span','仅供界面验证 · 未发布'));card.append(ph);}
      const body=el('div',null,'card-body');body.append(el('span',r.published?'已收录':'待核分店 · 待补截图','tag'),el('p',r.creator.name,'creator'),el('h2',r.visit.store_name),el('p',r.video.title,'title'),el('p',r.visit.branch_name?`${r.visit.district} · ${r.visit.address}`:'具体分店与地址待核实'),el('p',r.video.bvid+' · P'+r.video.part+' · '+r.video.published_at.slice(0,10),'bvid'));
      if(r.published&&r.visit.screenshots.length){const i=r.visit.screenshots[0];body.append(el('p','画面：'+i.alt+' · '+(i.timestamp_ms/1000)+' 秒 · 来源 '+r.video.bvid));}
      if(r.published){
        for(const o of (r.visit.opinions||[]).slice(0,2))body.append(el('p','UP 主观点：'+o.text+'（'+o.seconds+' 秒）'));
        for(const d of r.visit.dishes||[])body.append(el('p','菜品：'+d.text+'（'+d.seconds+' 秒）'));
      }
      const btn=el('button',r.published?'在本站查看视频':'核对原视频');btn.type='button';btn.onclick=()=>open(r,btn);body.append(btn);card.append(body);$('cards').append(card);
    }
    if(!found.length)$('cards').append(el('p',term?'没有匹配的探店记录。':'本批暂无正式卡片。可进入候选核对，查看九条来源和待补材料。','empty'));
  }
  $('content-query').oninput=render;
  (async()=>{
    try{
      const response=await fetch('/api/content'+(review?'?review=1':''));if(!response.ok)throw Error();const data=await response.json();records=data.records;
      $(review?'review-tab':'published-tab').setAttribute('aria-current','page');$('review-note').hidden=!review;
      $('summary').textContent=review?`${data.batches?.length||1} 个批次 · ${records.length} 条候选 · 已收录 ${data.published_count} 条 · ${new Set(records.map(r=>r.creator.uid)).size} 位 UP 主`:`已收录 ${data.published_count} 条 · 经分店与截图核对`;
      render();
      const visit=params.get('visit_id');
      if(visit){
        const r=records.find(r=>r.visit_id===visit);
        if(r)open(r,$('published-tab'));
        else $('summary').textContent='该到访记录不存在、已撤回或尚未公开。';
        return;
      }
      const bv=params.get('bvid');if(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/.test(bv||'')){
        if(records.filter(r=>r.video.bvid===bv).length>1){$('content-query').value=bv;render();$('summary').textContent='该视频包含多次到访，请选择对应分店。';return;}
        const r=records.find(r=>r.video.bvid===bv)||{video:{bvid:bv,title:bv,part:1,url:`https://www.bilibili.com/video/${bv}/`,playback_status:'pending'},player_url:`https://player.bilibili.com/player.html?bvid=${bv}&p=1&t=0&autoplay=0&danmaku=0`};
        open(r,$('published-tab'));
      }
    }catch{$('summary').textContent='内容暂时无法加载，请刷新重试。';}
  })();
})();
