(() => {
  const el=(tag,text,className)=>{const x=document.createElement(tag);if(text)x.textContent=text;if(className)x.className=className;return x;};
  function render(shop,index,onSelect){
    const item=el('li');item.dataset.storeId=shop.id||shop.name;
    const card=el('article',null,'result-card'),frame=el('div',null,'frame-slot');
    const missing=()=>{frame.replaceChildren(el('span','截图待补'));frame.dataset.missing='true';};
    if(shop.image?.kind==='video_screenshot'){
      const img=el('img');img.src=shop.image.url;img.alt=shop.image.alt;img.loading='eager';img.addEventListener('error',missing,{once:true});frame.append(img);
    }else missing();
    const body=el('div',null,'result-body'),title=el('div',null,'result-title');
    const name=el('button',shop.name,'shop-select');name.type='button';name.onclick=onSelect;
    title.append(el('span',String(index+1),'pin-number'),name,el('strong',(shop.meters/1000).toFixed(2)+' km','straight-distance'));
    body.append(title,el('p',shop.address,'store-address'));
    const creator=shop.creator||(shop.visits||[]).map(v=>v.creator).filter(Boolean).join('、');
    if(creator)body.append(el('p',creator+' · B 站探店','video-byline'));
    if(shop.note)body.append(el('p',creator+'探店：'+shop.note,'video-note'));
    if(shop.image)body.append(el('p','画面 P'+shop.image.part+' · '+(shop.image.timestamp_ms/1000)+' 秒','frame-source'));
    const bv=shop.video?.match(/BV[0-9A-Za-z]{10}/)?.[0];
    if(bv){const detail=el('a','查看探店详情 →','detail-action');detail.href='/content/?bvid='+bv;body.append(detail);}
    card.append(frame,body);item.append(card);return item;
  }
  window.FoodmapHomeCards={render};
})();
