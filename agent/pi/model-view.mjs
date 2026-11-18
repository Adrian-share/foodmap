// Presentation only: original registered payload and its SHA never change.
function currentVideo(payload,context){
 const d=payload?.data;
 if(payload?.code!==0||d?.bvid!==context.bvid||String(d?.owner?.mid)!==context.creator_uid)throw Error('metadata_view_identity_mismatch');
 return {code:payload.code,data:{bvid:d.bvid,title:d.title,desc:d.desc,owner:d.owner,pubdate:d.pubdate,pages:d.pages}};
}
export function modelToolResult(name,args,result,context){
 const id=name==='content_read_evidence'?args.evidence_id:result.evidence_id;
 if(context.evidence[id]?.kind!=='metadata')return result;
 const payload=name==='content_read_evidence'?JSON.parse(result.text):result.payload;
 const {payload:raw,text,...rest}=result;
 return {...rest,evidence_id:id,model_view:currentVideo(payload,context),
  note:'Model-only current-video projection. SHA refers to the full immutable registered official response; other collection episodes are omitted from display.'};
}
