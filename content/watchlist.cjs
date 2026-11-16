'use strict';
const UID=/^[1-9][0-9]{0,19}$/;
const BVURL=/^https:\/\/www\.bilibili\.com\/video\/BV[1-9A-HJ-NP-Za-km-z]{10}\/(?:\?p=[1-9][0-9]{0,3})?$/;
function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
function object(value,required,optional=[]){if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))fail('invalid_watchlist_schema');}
function validateWatchlist(w){
 object(w,['schema_version','city','sources'],['video_links']);
 if(w.schema_version!==1||w.city!=='北京'||!Array.isArray(w.sources)||!w.sources.length||w.sources.length>500||new TextEncoder().encode(JSON.stringify(w)).length>512*1024)fail('invalid_watchlist');
 const uids=new Set();
 for(const s of w.sources){object(s,['uid','name','profile_url','enabled','collection_scope','season_ids']);if(typeof s.uid!=='string'||!UID.test(s.uid)||uids.has(s.uid)||typeof s.name!=='string'||!s.name.length||s.name.length>100||s.profile_url!=='https://space.bilibili.com/'+s.uid||typeof s.enabled!=='boolean'||s.collection_scope!=='beijing'||!Array.isArray(s.season_ids)||s.season_ids.length>100||new Set(s.season_ids).size!==s.season_ids.length||s.season_ids.some(x=>typeof x!=='string'||!UID.test(x)))fail('invalid_watch_source');uids.add(s.uid);}
 if(w.video_links!==undefined){if(!Array.isArray(w.video_links)||w.video_links.length>2000)fail('invalid_video_links');for(const link of w.video_links){object(link,['uid','url']);if(!uids.has(link.uid)||typeof link.url!=='string'||!BVURL.test(link.url))fail('invalid_video_link');}}
 return w;
}
function validateGithub(g){object(g,['repo','ref','path','commit_sha','sha256','observed_at']);if(g.repo!=='Adrian-share/foodmap'||g.ref!=='fact-18/beijing-content-003'||g.path!=='content/watchlists/beijing.json'||!/^[a-f0-9]{40}$/.test(g.commit_sha)||!/^[a-f0-9]{64}$/.test(g.sha256)||typeof g.observed_at!=='string'||!/^\d{4}-\d\d-\d\dT/.test(g.observed_at)||!Number.isFinite(Date.parse(g.observed_at)))fail('invalid_github_revision');}
module.exports={validateWatchlist,validateGithub,object,fail};
