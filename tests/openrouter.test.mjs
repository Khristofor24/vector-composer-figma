import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_MODEL,validateAiResult,selectByMetaphor,checkConnection} from '../src/openrouter.mjs';
const catalog=JSON.parse(await readFile(new URL('../assets/catalog.json',import.meta.url),'utf8'));
const credential='TEST_ONLY_NOT_A_REAL_CREDENTIAL';
const result={items:[{id:'book',role:'main'},{id:'phone',role:'background'}],explanation:'Знания и онлайн-связь'};
const response=(content,status=200)=>({ok:status>=200&&status<300,status,json:async()=>status===200?{choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)}}]}:{error:{message:credential}}});

test('connection and metaphor calls accept browser-style fetch receivers, injected or global',async()=>{
 const originalFetch=globalThis.fetch;
 let calls=0;
 // WebIDL fetch accepts standalone/global calls but rejects an unrelated object receiver.
 function browserFetch(_url,init){
  if(this!==undefined&&this!==globalThis)throw new TypeError('invalid Window receiver');
  calls++;
  const topic=JSON.parse(init.body).messages[1].content;
  return Promise.resolve(response(topic.includes('"query"')?result:{ok:true}));
 }
 try{
  globalThis.fetch=browserFetch;
  const outcomes=await Promise.allSettled([
   checkConnection({apiKey:credential,fetchImpl:browserFetch}),
   selectByMetaphor({query:'Browser receiver injected',catalog,apiKey:credential,fetchImpl:browserFetch}),
   checkConnection({apiKey:credential}),
   selectByMetaphor({query:'Browser receiver global',catalog,apiKey:credential}),
  ]);
  assert.deepEqual(outcomes.map(outcome=>outcome.status==='fulfilled'?'fulfilled':outcome.reason.code),Array(4).fill('fulfilled'));
  for(const index of [0,2])assert.deepEqual(outcomes[index].value,{ok:true,model:DEFAULT_MODEL});
  for(const index of [1,3])assert.deepEqual(outcomes[index].value,{...result,cached:false});
  assert.equal(calls,4);
 }finally{globalThis.fetch=originalFetch;}
});

test('AI validator accepts catalog-only structured JSON and a genuine empty match',()=>{
 assert.deepEqual(validateAiResult(JSON.stringify(result),catalog),result);
 assert.deepEqual(validateAiResult('```json\n'+JSON.stringify(result)+'\n```',catalog),result);
 assert.deepEqual(validateAiResult({items:[],explanation:'Нет подходящих объектов'},catalog),{items:[],explanation:'Нет подходящих объектов'});
});

test('AI validator rejects malformed JSON, unknown objects, roles and untrusted shapes',()=>{
 for(const invalid of ['<svg/>','not json',null,{items:'book',explanation:''},{items:[{id:'dragon',role:'main'}],explanation:''},{items:[{id:'book',role:'hero'}],explanation:''},{items:[{id:'book'}],explanation:''},{items:[],explanation:{code:'evil'}}])assert.throws(()=>validateAiResult(invalid,catalog),error=>error.code==='INVALID_RESPONSE');
});

test('manual Gemma metaphor request preserves JSON mode and metadata-only catalogue; cache returns immutable data',async()=>{
 const requests=[];const fetchImpl=async(url,init)=>{requests.push({url,init});return response(result);};
 const args={query:'Тест обучения онлайн — запрос 1',catalog,apiKey:credential,model:'google/gemma-4-31b-it:free',fetchImpl};
 const first=await selectByMetaphor(args);
 assert.deepEqual(first.items,result.items);assert.equal(first.cached,false);assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://openrouter.ai/api/v1/chat/completions');
 assert.equal(requests[0].init.headers.Authorization,`Bearer ${credential}`);
 const body=JSON.parse(requests[0].init.body);
 assert.equal(body.model,'google/gemma-4-31b-it:free');assert.equal(body.response_format.type,'json_object');
 assert.deepEqual(body.reasoning,{enabled:false});assert.equal(body.provider,undefined);
 assert.match(JSON.stringify(body.messages),/book/);assert.doesNotMatch(JSON.stringify(body.messages),/<svg|<path|sourceHashes/);assert.ok(!requests[0].init.body.includes(credential));
 first.items[0].id='mutated';
 const second=await selectByMetaphor(args);
 assert.equal(second.items[0].id,'book');assert.equal(second.cached,true);assert.equal(requests.length,1);
 assert.ok(!JSON.stringify(second).includes(credential));
});

test('a user-selected model is kept, without paid fallback or unsupported forced JSON parameters',async()=>{
 let body;
 const actual=await selectByMetaphor({query:'Своя модель — запрос 2',catalog,apiKey:credential,model:'custom/selected:free',fetchImpl:async(_url,init)=>{body=JSON.parse(init.body);return response(result);}});
 assert.deepEqual(actual.items,result.items);assert.equal(body.model,'custom/selected:free');assert.equal(body.models,undefined);assert.equal(body.response_format,undefined);
 assert.equal(body.provider,undefined);assert.equal(body.reasoning,undefined);
});

test('fixed free NVIDIA default requests the verified JSON profile for connection and metaphor',async()=>{
 const expectedModel='nvidia/nemotron-3.5-super-vl:free';
 const bodies=[];
 const fetchImpl=async(_url,init)=>{
  const body=JSON.parse(init.body);
  bodies.push(body);
  return response(body.messages[1].content.includes('"query"')?result:{ok:true});
 };
 for(const model of [undefined,expectedModel]){
  assert.deepEqual(await checkConnection({apiKey:credential,model,fetchImpl}),{ok:true,model:expectedModel});
  assert.deepEqual(await selectByMetaphor({query:`NVIDIA verified profile ${model??'default'}`,catalog,apiKey:credential,model,fetchImpl}),{...result,cached:false});
 }
 assert.equal(bodies.length,4);
 for(const body of bodies){
  assert.equal(body.model,expectedModel);
  assert.deepEqual(body.response_format,{type:'json_object'});
  assert.deepEqual(body.provider,{require_parameters:true});
  assert.deepEqual(body.reasoning,{enabled:false});
  assert.equal(body.models,undefined);
 }
});

test('known free router requests JSON-capable providers for connection and metaphor without forcing reasoning',async()=>{
 const bodies=[];
 const fetchImpl=async(url,init)=>{
  assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
  const body=JSON.parse(init.body);
  bodies.push(body);
  return response(body.messages[1].content.includes('"query"')?result:{ok:true});
 };
 assert.deepEqual(await checkConnection({apiKey:credential,model:'openrouter/free',fetchImpl}),{ok:true,model:'openrouter/free'});
 assert.deepEqual(await selectByMetaphor({query:'Free router JSON capability regression',catalog,apiKey:credential,model:'openrouter/free',fetchImpl}),{...result,cached:false});
 assert.equal(bodies.length,2);
 for(const body of bodies){
  assert.deepEqual(body.response_format,{type:'json_object'});
  assert.deepEqual(body.provider,{require_parameters:true});
  assert.equal(body.reasoning,undefined);
  assert.equal(body.model,'openrouter/free');
  assert.equal(body.models,undefined);
 }
});

test('401/403 and non-transient HTTP errors are not retried and never expose provider text or credentials',async()=>{
 for(const status of [400,401,402,403,404]){
  let calls=0;
  await assert.rejects(()=>selectByMetaphor({query:`Отказ ${status}`,catalog,apiKey:credential,fetchImpl:async()=>{calls++;return response(null,status);}}),error=>!error.message.includes(credential)&&error.status===status);
  assert.equal(calls,1);
 }
});

test('transient 429 and 5xx are retried once at most, with the same model',async()=>{
 for(const status of [429,500,503]){
  let calls=0;
  const actual=await selectByMetaphor({query:`Временный сбой ${status}`,catalog,apiKey:credential,retryDelayMs:0,fetchImpl:async()=>++calls===1?response(null,status):response(result)});
  assert.equal(calls,2);assert.deepEqual(actual.items,result.items);
 }
 let calls=0;
 await assert.rejects(()=>selectByMetaphor({query:'Повторный лимит',catalog,apiKey:credential,retryDelayMs:0,fetchImpl:async()=>{calls++;return response(null,429);}}),error=>error.status===429);
 assert.equal(calls,2);
});

test('network errors and invalid response bodies are safe failures without silent local AI',async()=>{
 await assert.rejects(()=>selectByMetaphor({query:'Сеть',catalog,apiKey:credential,fetchImpl:async()=>{throw new Error(`network ${credential}`);}}),error=>!error.message.includes(credential)&&error.code==='NETWORK');
 await assert.rejects(()=>selectByMetaphor({query:'Сломанный JSON',catalog,apiKey:credential,fetchImpl:async()=>response('not json')}),error=>error.code==='INVALID_RESPONSE');
 await assert.rejects(()=>selectByMetaphor({query:'Пустой ответ',catalog,apiKey:credential,fetchImpl:async()=>({ok:true,status:200,json:async()=>({choices:[]})})}),error=>error.code==='INVALID_RESPONSE');
});

test('deadline aborts a non-cooperating transport and the request signal',async()=>{
 let signal;
 await assert.rejects(()=>selectByMetaphor({query:'Тайм-аут',catalog,apiKey:credential,timeoutMs:15,fetchImpl:async(_url,init)=>{signal=init.signal;return new Promise(()=>{});}}),error=>error.code==='TIMEOUT');
 assert.equal(signal.aborted,true);
});

test('external cancellation is immediate and distinct from a timeout',async()=>{
 const controller=new AbortController();
 const pending=selectByMetaphor({query:'Отмена',catalog,apiKey:credential,signal:controller.signal,fetchImpl:async()=>new Promise(()=>{})});
 controller.abort();
 await assert.rejects(()=>pending,error=>error.code==='ABORTED');
});

test('connection test makes a real model-shaped request, bypasses cache and validates a response',async()=>{
 let calls=0;
 const fetchImpl=async(_url,init)=>{calls++;assert.equal(JSON.parse(init.body).model,DEFAULT_MODEL);return response({ok:true});};
 assert.deepEqual(await checkConnection({apiKey:credential,fetchImpl}),{ok:true,model:DEFAULT_MODEL});
 assert.deepEqual(await checkConnection({apiKey:credential,fetchImpl}),{ok:true,model:DEFAULT_MODEL});
 assert.equal(calls,2);
 await assert.rejects(()=>checkConnection({apiKey:credential,fetchImpl:async()=>response({ok:false})}),error=>error.code==='INVALID_RESPONSE');
});

test('invalid inputs fail before any request and credentials are required even with cached query',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return response(result);};
 for(const args of [{query:'',apiKey:credential},{query:'Книга',apiKey:''},{query:'Книга',apiKey:credential,model:'https://not-a-model.test'}])await assert.rejects(()=>selectByMetaphor({...args,catalog,fetchImpl}),error=>['INVALID_INPUT','KEY_REQUIRED'].includes(error.code));
 assert.equal(calls,0);
});

test('credential accidentally included in topic or provider content is never sent as topic, returned or cached',async()=>{
 let calls=0;
 await assert.rejects(()=>selectByMetaphor({query:`Тема ${credential}`,catalog,apiKey:credential,fetchImpl:async()=>{calls++;return response(result);}}),error=>error.code==='INVALID_INPUT'&&!error.message.includes(credential));
 assert.equal(calls,0);
 const query='Ответ провайдера с лишними данными';
 await assert.rejects(()=>selectByMetaphor({query,catalog,apiKey:credential,fetchImpl:async()=>{calls++;return response({...result,explanation:credential});}}),error=>error.code==='INVALID_RESPONSE'&&!error.message.includes(credential));
 const clean=await selectByMetaphor({query,catalog,apiKey:credential,fetchImpl:async()=>{calls++;return response(result);}});
 assert.equal(clean.cached,false);assert.equal(calls,2);assert.ok(!JSON.stringify(clean).includes(credential));
});

