(() => {
  const el=(tag,text,className)=>{const x=document.createElement(tag);if(text)x.textContent=text;if(className)x.className=className;return x;};
  function render(shop,index,onSelect){
    const item=el('li');item.dataset.storeId=shop.id||shop.name;item.setAttribute('aria-current','false');
    if(shop.featured_visit_id)item.dataset.visitId=shop.featured_visit_id;
    const card=el('article',null,'result-card'),frame=el('div',null,'frame-slot');
    const missing=()=>{frame.replaceChildren(el('span','截图待补'));frame.dataset.missing='true';};
    if(shop.image?.kind==='video_screenshot'){
      const img=el('img');img.src=shop.image.url;img.alt=shop.image.alt;img.loading=index<6?'eager':'lazy';img.addEventListener('error',missing,{once:true});frame.append(img);
    }else missing();
    const body=el('div',null,'result-body'),title=el('div',null,'result-title');
    const name=el('button',shop.name,'shop-select');name.type='button';name.title='在地图上选中这家门店';
    title.append(el('span',String(index+1),'pin-number'),name,el('strong',(shop.meters/1000).toFixed(2)+' km','straight-distance'));
    body.append(title);
    const creator=shop.creator||(shop.visits||[]).map(v=>v.creator).filter(Boolean).join('、');
    body.append(el('p',(creator||'原视频作者')+' · B 站探店','video-byline'));
    body.append(el('p',shop.note||shop.card?.video?.title||'查看原视频中的门店与探店记录。','video-note'));
    body.append(el('p',shop.address,'store-address'));
    const bv=shop.video?.match(/BV[0-9A-Za-z]{10}/)?.[0];
    if(bv){const detail=el('a',null,'detail-action');detail.href=shop.detail_url||'/content/?bvid='+bv;detail.setAttribute('aria-label','查看探店详情 →');detail.title='查看 '+shop.name+' 的探店详情';detail.append(frame,el('span','查看探店详情 ↗','detail-label'));card.append(detail);}else card.append(frame);
    card.addEventListener('click',event=>{if(!event.target.closest('a'))onSelect();});
    card.append(body);item.append(card);return item;
  }
  window.FoodmapHomeCards={render};
})();
