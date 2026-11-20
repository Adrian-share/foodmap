'use strict';
const validators=require('./protocol-validators.cjs');
function fail(code,status=400){throw Object.assign(Error(code),{status});}
function validate(name,value){if(!validators[name]?.(value))fail('invalid_'+name);return value;}
const encode=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
async function sha(bytes){if(typeof bytes==='string')bytes=encode(bytes);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
function strict(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))fail('invalid_evidence_fields');}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
module.exports={validate,fail,encode,sha,strict,equal,canonical};
