(() => {
'use strict';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),admin=location.pathname.startsWith('/admin/'),uid=params.get('uid');
let videos=[],accounts=[],version;
const statusName={published:'已公开',pending:'待核',excluded:'排除'};
function el(tag,text,cls){const x=document.createElement(tag);if(text!==undefined&&text!==null)x.textContent=String(text);if(cls)x.className=cls;return x;}
function link(text,url){const a=el('a',text);a.href=url;return a;}
const date=x=>x?(x.length===10?x:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(x))):'待补';
const visitName=v=>v.store_name===v.branch_name?v.store_name:[v.store_name,v.branch_name].filter(Boolean).join(' · ');
const badge=s=>el('span',statusName[s]||s,'badge '+s);
async function read(url){const r=await fetch(url,{cache:'no-store'});if(r.status===401){const data=await r.json();location.assign(data.sign_in_url);throw Error('请先登录');}if(!r.ok)throw Error(r.status===404?'该博主暂无已公开视频。':'内容暂时无法读取，请刷新重试。');return r.json();}
function showPlayer(v,visit){$('player-title').textContent=v.title;$('player-source').textContent=v.bvid+' · P'+visit.part+' · '+v.url;
const frame=el('iframe');frame.title=v.title+' · B站官方播放器';frame.src=visit.player_url;frame.allow='fullscreen; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');$('player-slot').replaceChildren(frame);$('player').showModal();}
$('close-player').onclick=()=>$('player').close();$('player').addEventListener('close',()=>$('player-slot').replaceChildren());
function stats(c){const box=el('div',null,'stats');for(const [key,label] of [['discovered','发现视频'],['published','已公开视频'],['pending','待核视频'],['excluded','排除视频'],['searchable_stores','可搜分店']]){const x=el('div',null,'stat');x.append(el('strong',c.counts[key]),el('span',label));box.append(x);}return box;}
function overview(){
 const box=$('overview');
 if(!admin){box.className='grid';for(const c of accounts){const a=link('', '/creators/?uid='+c.uid);a.className='creator';a.append(el('span',c.name.slice(0,1),'avatar'),el('h2',c.name),el('p',c.video_count+' 个北京视频 · '+c.store_count+' 家分店'),el('span','打开视频合集 ↗','arrow'));box.append(a);}return;}
 const wrap=el('div',null,'table-wrap'),table=el('table'),head=el('thead'),tr=el('tr');for(const t of ['博主 / UID','发现','公开','待核','排除','可搜分店','最近发现 / 已公开最晚发稿','盘点范围 / 停止位置'])tr.append(el('th',t));head.append(tr);table.append(head);const body=el('tbody');
 for(const c of accounts){const row=el('tr');row.dataset.uid=c.uid;const name=el('td');name.append(link(c.name,'/admin/creators/?uid='+c.uid),el('small',c.uid),el('small',({first_batch:'首批账号',candidate:'候选',related_candidate:'关联候选',site_existing:'原站账号'})[c.selection_status]||c.selection_status));row.append(name);for(const k of ['discovered','published','pending','excluded','searchable_stores'])row.append(el('td',c.counts[k]));
 const dates=el('td');dates.append(el('div','发现 '+date(c.latest_discovered?.discovered_at)),el('small',c.latest_discovered?.bvid||'无'),el('div','发稿 '+date(c.latest_published?.bilibili_published_at)),el('small',c.latest_published?.bvid||'尚未公开'));row.append(dates);
 const coverage=el('td');coverage.append(el('span',c.coverage.status==='restricted'?'访问受限':'部分盘点','badge pending'),el('div',c.coverage.scope),el('small','停止：'+c.coverage.stop),el('small','上次盘点 '+date(c.coverage.checked_at)));row.append(coverage);body.append(row);}
 table.append(body);wrap.append(table);box.append(wrap);
}
function account(c){
 const box=el('div',null,'account');box.append(el('h2',c.name),link('B站主页 · '+c.uid,c.profile_url));
 if(admin){box.append(stats(c));box.append(el('p','最近发现（登记/快照）：'+date(c.latest_discovered?.discovered_at)+' · '+(c.latest_discovered?.bvid||'暂无')),el('p','已公开中发稿最晚：'+date(c.latest_published?.bilibili_published_at)+' · '+(c.latest_published?.bvid||'尚未公开')));const scope=el('div',null,'coverage');for(const [label,text] of [['覆盖范围',c.coverage.scope],['来源停止位置',c.coverage.stop],['上次盘点',c.coverage.checked_at],['访问受限',c.coverage.restriction],['下一步',c.coverage.next_step],['账号关系',c.relationship_note]])if(text)scope.append(el('p',label+'：'+text));scope.append(el('p','仅代表以上来源范围；账号历史未穷尽。'));box.append(scope);}
 else box.append(el('p',c.video_count+' 个已公开视频 · '+c.store_count+' 家可在地图查看的分店','meta'));
 $('account').replaceChildren(box);
}
function renderVideos(){
 const term=$('video-query').value.toLowerCase().trim(),s=$('review-status').value;
 const found=videos.filter(v=>(!s||v.status===s)&&(!term||JSON.stringify([v.title,v.bvid,v.visits.map(x=>[x.store_name,x.branch_name])]).toLowerCase().includes(term)));$('videos').replaceChildren();
 if(!found.length){$('videos').append(el('p',admin?'当前筛选下没有视频；可查看账号盘点范围或更换状态。':'这位博主暂无已公开视频。','empty'));return;}
 if(admin){const wrap=el('div',null,'table-wrap'),table=el('table'),tr=el('tr');for(const label of ['原视频 / 来源','B站发稿 / 本站收录','分店与审核状态','缺项 / 来源'])tr.append(el('th',label));const head=el('thead');head.append(tr);table.append(head);const body=el('tbody');
 for(const v of found){const row=el('tr');row.dataset.bvid=v.bvid;const title=el('td');title.append(link(v.title,v.url),el('small',v.bvid));const dates=el('td');dates.append(el('div',date(v.bilibili_published_at)),el('small','本站收录：'+date(v.included_at)),el('small','发现：'+date(v.discovered_at)+'（'+(v.discovery_time_precision==='snapshot_day'?'快照日期':'登记时间')+'）'));const visits=el('td');visits.append(badge(v.status));for(const x of v.visits)visits.append(el('p',[x.store_name,x.branch_name].filter(Boolean).join(' · ')),el('small',x.review_status+' · P'+x.part+' · '+(x.store_id||'分店未核准')));if(!v.visits.length)visits.append(el('p','尚未形成分店到访记录'));
 const missing=el('td');missing.append(el('div',v.missing.join('；')||'当前已有核准北京到访','missing'));if(v.identity_warning)missing.append(el('p',v.identity_warning,'missing'));const detail=el('details');detail.append(el('summary','查看 '+v.sources.length+' 个来源'));for(const source of v.sources)detail.append(source.startsWith('https://')?link(source,source):el('small',source));missing.append(detail);row.append(title,dates,visits,missing);body.append(row);}
 table.append(body);wrap.append(table);$('videos').append(wrap);return;}
 for(const v of found){const card=el('article',null,'video-card');card.dataset.bvid=v.bvid;const first=v.visits[0],shot=first.screenshots?.[0];if(shot){const img=el('img');img.src='/'+shot.path;img.alt=shot.alt;img.loading='lazy';card.append(img);}else card.append(el('div','截图待补','empty'));
 const body=el('div',null,'body');body.append(el('span',date(v.bilibili_published_at)==='待补'?'B站发稿日期待补':'B站发稿 '+date(v.bilibili_published_at),'meta'),el('h2',v.title),el('small',v.bvid));
 for(const visit of v.visits){const x=el('div',null,'visit');x.append(el('strong',visitName(visit)),el('p',visit.address||'地址待补','meta'));const actions=el('div',null,'actions'),play=el('button','在本站播放');play.type='button';play.onclick=()=>showPlayer(v,visit);actions.append(play,link('地图位置 ↗',visit.map_url),link('到访详情',visit.detail_url));x.append(actions);body.append(x);}card.append(body);$('videos').append(card);}
}
$('review-status').onchange=renderVideos;$('video-query').oninput=renderVideos;
(async()=>{try{
 if(admin){$('title').textContent='北京内容台账';$('intro').textContent='按账号核对来源、覆盖范围与待补材料。内容通过批次审核工作流维护。';$('eyebrow').textContent='CONTENT / READ ONLY';document.title='北京探店 · 内容后台';}
 const data=await read(admin?'/api/admin/creators':'/api/creators');version=data.version;accounts=data.creators;
 if(admin&&data.definitions){$('definitions').hidden=false;for(const [key,text] of Object.entries(data.definitions))$('definition-list').append(el('dt',key),el('dd',text));}
 if(!uid){overview();$('status').textContent=accounts.length+' 位博主'+(admin?' · 快照 '+date(data.as_of):' · 已公开的北京探店视频');return;}
 $('back').hidden=false;$('back').href=admin?'/admin/creators/':'/creators/';$('detail').hidden=false;let c;
 if(admin){c=accounts.find(c=>c.uid===uid);if(!c)throw Error('账号不存在');const list=await read('/api/admin/videos?uid='+encodeURIComponent(uid));if(list.version!==version)throw Error('内容版本已更新，请刷新。');videos=list.videos;$('filters').hidden=false;}
 else{const collection=await read('/api/creators/'+encodeURIComponent(uid));if(collection.version!==version)throw Error('内容版本已更新，请刷新。');c=collection.creator;videos=collection.videos;}
 $('title').textContent=c.name+(admin?' · 视频明细':' · 北京视频合集');account(c);renderVideos();$('status').textContent=videos.length+' 个视频 · B站发稿日期倒序，未知日期置后';
 }catch(e){$('status').textContent=e.message;}})();
})();
