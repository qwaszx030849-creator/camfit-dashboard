'use strict';
const PROJECT='camfit-md-dashboard-phj';
const OWNER='qwaszx030849@gmail.com';
const ROOT='projects/'+PROJECT+'/databases/(default)/documents';
function decode(v){
  if(!v)return null;
  if('stringValue' in v)return v.stringValue;
  if('integerValue' in v)return Number(v.integerValue);
  if('doubleValue' in v)return v.doubleValue;
  if('booleanValue' in v)return v.booleanValue;
  if('timestampValue' in v)return v.timestampValue;
  if('arrayValue' in v)return(v.arrayValue.values||[]).map(decode);
  if('mapValue' in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
  return null;
}
function fields(doc){return Object.fromEntries(Object.entries(doc?.fields||{}).map(([k,v])=>[k,decode(v)]));}
function encode(v){
  if(v===null||v===undefined)return{nullValue:null};
  if(typeof v==='string')return{stringValue:v};
  if(typeof v==='boolean')return{booleanValue:v};
  if(typeof v==='number')return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(Array.isArray(v))return{arrayValue:{values:v.map(encode)}};
  return{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
}
async function context(){
  // Use the Firebase CLI's normal configured account, never copy credentials.
  const auth=require('firebase-tools/lib/auth');
  const {requireAuth}=require('firebase-tools/lib/requireAuth');
  const {Client}=require('firebase-tools/lib/apiv2');
  const account=auth.findAccountByEmail(OWNER);
  if(!account)throw new Error('기존 Firebase 관리자 로그인이 필요합니다.');
  const options={project:PROJECT,nonInteractive:true};
  auth.setActiveAccount(options,account);
  await requireAuth(options);
  const id=new Client({urlPrefix:'https://identitytoolkit.googleapis.com',apiVersion:'v1'});
  const lookup=await id.post('projects/'+PROJECT+'/accounts:lookup',{email:[OWNER]});
  const owner=lookup.body.users?.find(u=>u.email===OWNER);
  if(!owner?.localId)throw new Error('대시보드 소유자 계정을 확인할 수 없습니다.');
  const uid=owner.localId;
  const db=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
  async function get(path){
    try{return(await db.get(ROOT+'/'+path)).body;}
    catch(e){if(e.status===404||e.context?.response?.statusCode===404)return null;throw e;}
  }
  async function load(group='dashboard',chunkGroup='dashboardChunks'){
    const metaDoc=await get('users/'+uid+'/'+group+'/'+(group==='dashboard'?'meta':'latest'));
    if(!metaDoc)return{payload:null,meta:null};
    const meta=fields(metaDoc),parts=[];
    if(!Number.isInteger(meta.chunks)||meta.chunks<0||meta.chunks>400)throw new Error('잘못된 데이터 조각 수');
    for(let i=0;i<meta.chunks;i++){
      const doc=await get('users/'+uid+'/'+chunkGroup+'/'+String(i).padStart(3,'0'));
      if(!doc)throw new Error('데이터 조각이 누락되어 갱신을 중단했습니다.');
      const part=fields(doc);
      if(group!=='dashboard'&&part.version!==meta.version)throw new Error('데이터 갱신 중입니다. 다시 실행해 주세요.');
      parts.push(part.payload||'');
    }
    return{payload:parts.length?JSON.parse(parts.join('')):null,meta,updateTime:metaDoc.updateTime};
  }
  async function saveBriefing(value,sourceUpdateTime,reason,expectedVersion){
    const old=await get('users/'+uid+'/briefing/latest'),oldData=fields(old);
    if((oldData.version||null)!==(expectedVersion||null))throw new Error('브리핑이 다른 곳에서 갱신되었습니다. 다시 실행해 주세요.');
    const text=JSON.stringify(value),parts=[],version=new Date().toISOString();
    for(let i=0;i<text.length;i+=180000)parts.push(text.slice(i,i+180000));
    if(parts.length>390)throw new Error('브리핑이 저장 한도를 초과했습니다.');
    const writes=parts.map((payload,i)=>({update:{name:ROOT+'/users/'+uid+'/briefingChunks/'+String(i).padStart(3,'0'),fields:encode({payload,version}).mapValue.fields}}));
    for(let i=parts.length;i<(oldData.chunks||0);i++)writes.push({delete:ROOT+'/users/'+uid+'/briefingChunks/'+String(i).padStart(3,'0')});
    writes.push({update:{name:ROOT+'/users/'+uid+'/briefing/latest',fields:encode({chunks:parts.length,version,updatedAt:version,sourceUpdatedAt:sourceUpdateTime,reason}).mapValue.fields},currentDocument:old?{updateTime:old.updateTime}:{exists:false}});
    const source=await get('users/'+uid+'/dashboard/meta');
    if(source.updateTime!==sourceUpdateTime)throw new Error('정산 데이터가 갱신 중입니다. 새 데이터로 다시 실행해 주세요.');
    writes.push({verify:ROOT+'/users/'+uid+'/dashboard/meta',currentDocument:{updateTime:sourceUpdateTime}});
    await db.post(ROOT+':commit',{writes});
    return{version,chunks:parts.length};
  }
  return{uid,load,saveBriefing,fields};
}
module.exports={context,fields,encode,decode};
if(require.main===module)context().then(async c=>{
  const {payload,meta}=await c.load();
  console.log(JSON.stringify({connected:true,camps:payload?.raw?.camps?.length||0,monthly:payload?.raw?.monthly?.length||0,onlineRS:payload?.onlineRS?.length||0,settlementCamps:Object.keys(payload?.settlements||{}).length,sourceUpdatedAt:meta?.updatedAt},null,2));
}).catch(e=>{console.error('대시보드 연결 실패: '+e.message);process.exitCode=1;});
