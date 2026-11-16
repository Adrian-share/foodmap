import {spawn} from 'node:child_process';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
// Network media never becomes a file or a whole-source Buffer. Backpressure keeps
// at most stream chunks in memory; the encoder closes stdin after the selected PNG.
export async function decodeFrameFromStream(response,timestamp,ffmpeg,signal){
 let downloaded_bytes=0,outputSize=0,logSize=0;const output=[],logs=[];
 const child=spawn(ffmpeg,['-hide_banner','-loglevel','info','-protocol_whitelist','pipe','-analyzeduration','1000000','-probesize','1048576','-i','pipe:0','-an','-vf',`select=gte(t\\,${timestamp/1000}),showinfo,signalstats,metadata=print`,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin'},signal});
 child.stdout.on('data',b=>{outputSize+=b.length;if(outputSize>8*1024*1024)child.kill();else output.push(b);});
 child.stderr.on('data',b=>{logSize+=b.length;if(logSize<=128*1024)logs.push(b);});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,termination)=>resolve({code,termination}));});
 const capped=new Transform({transform(chunk,_encoding,callback){downloaded_bytes+=chunk.length;callback(downloaded_bytes>128*1024*1024?Error('source_too_large'):null,chunk);}});
 const feed=pipeline(Readable.fromWeb(response.body),capped,child.stdin).catch(error=>{if(!['EPIPE','ERR_STREAM_PREMATURE_CLOSE','ABORT_ERR'].includes(error.code))child.kill();return error;});
 const exit=await done;const error=await feed;
 if(error?.message==='source_too_large')throw error;
 if(exit.code!==0||outputSize>8*1024*1024)throw Error('frame_decode_failed');
 return {image:Buffer.concat(output),log:Buffer.concat(logs).toString(),downloaded_bytes};
}
