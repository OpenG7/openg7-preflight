import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { BrowserOidcClient, type BrowserOidcConfig } from '../apps/admin-web/src/app/core/oidc-client.js';

const config:BrowserOidcConfig={enabled:true,issuer:'https://identity.example.test',clientId:'preflight-console',redirectUri:'https://console.example.test/'};
function fixture(current='https://console.example.test/'){
  const entries=new Map<string,string>();let target='';let cleaned=false;
  const browser={storage:{getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value);},removeItem:(key:string)=>{entries.delete(key);}},currentUrl:()=>new URL(current),redirect:(url:string)=>{target=url;},cleanCallback:()=>{cleaned=true;}};
  return {entries,browser,target:()=>target,cleaned:()=>cleaned,setUrl:(value:string)=>{current=value;}};
}
const discovery:typeof fetch=async()=>new Response(JSON.stringify({issuer:config.issuer,authorization_endpoint:`${config.issuer}/authorize`,token_endpoint:`${config.issuer}/token`,jwks_uri:`${config.issuer}/keys`,response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256']}),{headers:{'content-type':'application/json'}});
test('browser login uses PKCE S256, state and nonce without storing an access token',async()=>{
  const f=fixture();await new BrowserOidcClient(config,f.browser,discovery).begin();
  const target=new URL(f.target());assert.equal(target.searchParams.get('code_challenge_method'),'S256');
  assert.equal(target.searchParams.has('prompt'),false);
  assert.equal(target.searchParams.get('scope'),'openid');
  assert.ok(target.searchParams.get('state'));assert.ok(target.searchParams.get('nonce'));assert.ok(target.searchParams.get('code_challenge'));
  const saved=JSON.parse(f.entries.get('preflight.oidc.flow.v1')!) as Record<string,unknown>;
  assert.ok(saved['verifier']);assert.equal(saved['access_token'],undefined);assert.equal(saved['redirectUri'],config.redirectUri);
});
test('callback rejects changed, missing and expired state before exchanging the code and consumes state once',async()=>{
  for(const variant of ['missing','changed','expired','issuer']){
    const f=fixture('https://console.example.test/?code=synthetic-code&state=expected');let requests=0;
    const flow={state:variant==='changed'?'different':'expected',nonce:'nonce',verifier:'verifier',createdAt:Date.now()-(variant==='expired'?700000:0),issuer:variant==='issuer'?'https://other.example.test':config.issuer,clientId:config.clientId,redirectUri:config.redirectUri};
    if(variant!=='missing')f.entries.set('preflight.oidc.flow.v1',JSON.stringify(flow));
    const client=new BrowserOidcClient(config,f.browser,async()=>{requests++;throw new Error('must_not_call');});
    await assert.rejects(()=>client.resume(),/oidc_state/);assert.equal(requests,0);assert.equal(f.entries.has('preflight.oidc.flow.v1'),false);assert.equal(f.cleaned(),true);
    f.setUrl('https://console.example.test/');
    assert.equal(await client.beginAutomatically(),false);
  }
});
test('authorization code callback exchanges the one-time verifier and validates the returned nonce',async()=>{
  const f=fixture();const keys=await generateKeyPair('RS256');let tokenRequests=0;
  const fetcher:typeof fetch=async(input,init)=>{
    if(!String(input).endsWith('/token'))return discovery(input,init);
    tokenRequests++;
    const flow=JSON.parse(saved) as {nonce:string;verifier:string};
    const body=new URLSearchParams(String(init?.body));assert.equal(body.get('code_verifier'),flow.verifier);assert.equal(body.get('redirect_uri'),config.redirectUri);
    const idToken=await new SignJWT({nonce:flow.nonce}).setProtectedHeader({alg:'RS256'}).setIssuer(config.issuer!).setAudience(config.clientId!).setSubject('synthetic-user').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    return new Response(JSON.stringify({access_token:'synthetic-access-token',token_type:'Bearer',expires_in:300,id_token:idToken}),{headers:{'content-type':'application/json'}});
  };
  let saved='';const client=new BrowserOidcClient(config,f.browser,fetcher);await client.begin();
  saved=f.entries.get('preflight.oidc.flow.v1')!;const flow=JSON.parse(saved) as {state:string};
  f.setUrl(`https://console.example.test/?code=synthetic-code&state=${flow.state}`);
  assert.equal(await client.resume(),'synthetic-access-token');assert.equal(tokenRequests,1);assert.equal(f.entries.has('preflight.oidc.flow.v1'),false);assert.equal(f.cleaned(),true);
  await assert.rejects(()=>client.resume(),/state_missing/);assert.equal(tokenRequests,1);
});

test('automatic login runs once per tab until the API accepts the session or the person explicitly retries',async()=>{
  const f=fixture();let requests=0;
  const fetcher:typeof fetch=async(input,init)=>{requests++;return discovery(input,init);};
  const client=new BrowserOidcClient(config,f.browser,fetcher);
  assert.equal(await client.beginAutomatically(),true);assert.equal(requests,1);
  assert.equal(await new BrowserOidcClient(config,f.browser,fetcher).beginAutomatically(),false);assert.equal(requests,1);
  await client.begin();assert.equal(requests,2);
  client.sessionEstablished();
  assert.equal(await new BrowserOidcClient(config,f.browser,fetcher).beginAutomatically(),true);assert.equal(requests,3);
});

test('local logout blocks automatic login across reloads while leaving explicit SSO available',async()=>{
  const f=fixture();const client=new BrowserOidcClient(config,f.browser,discovery);
  client.suspendAutomaticLogin();
  assert.equal(await new BrowserOidcClient(config,f.browser,discovery).beginAutomatically(),false);assert.equal(f.target(),'');
  await client.begin();assert.equal(new URL(f.target()).origin,new URL(config.issuer!).origin);
});

test('explicit MFA recovery requests a fresh login without changing the normal SSO path',async()=>{
  const f=fixture();
  await new BrowserOidcClient(config,f.browser,discovery).begin({reauthenticate:true});
  const target=new URL(f.target());assert.equal(target.searchParams.get('prompt'),'login');assert.equal(target.searchParams.get('code_challenge_method'),'S256');
});

test('an unavailable provider blocks automatic retries after reload without persisting credentials',async()=>{
  const f=fixture();let requests=0;
  const unavailable:typeof fetch=async()=>{requests++;throw new Error('synthetic_provider_unavailable');};
  await assert.rejects(()=>new BrowserOidcClient(config,f.browser,unavailable).beginAutomatically(),/synthetic_provider_unavailable/);
  assert.equal(await new BrowserOidcClient(config,f.browser,unavailable).beginAutomatically(),false);assert.equal(requests,1);
  assert.equal(f.entries.has('preflight.oidc.flow.v1'),false);
  assert.equal([...f.entries.values()].some(value=>value.includes('access_token')||value.includes('verifier')),false);
});

test('automatic login leaves disabled OIDC and incoming callbacks untouched',async()=>{
  for(const current of ['https://console.example.test/?code=synthetic-code','https://console.example.test/?error=access_denied']){
    const f=fixture(current);assert.equal(await new BrowserOidcClient(config,f.browser,discovery).beginAutomatically(),false);assert.equal(f.entries.size,0);
  }
  const f=fixture();assert.equal(await new BrowserOidcClient({enabled:false},f.browser,discovery).beginAutomatically(),false);assert.equal(f.entries.size,0);
});
test('browser auth refuses insecure remote endpoints, different redirect origins and providers without S256',async()=>{
  const f=fixture();
  await assert.rejects(()=>new BrowserOidcClient({...config,issuer:'http://remote.example.test'},f.browser,discovery).begin(),/endpoint_invalid/);
  await assert.rejects(()=>new BrowserOidcClient({...config,redirectUri:'https://attacker.example.test/'},f.browser,discovery).begin(),/redirect_origin_mismatch/);
  await assert.rejects(()=>new BrowserOidcClient(config,f.browser,async()=>new Response(JSON.stringify({issuer:config.issuer,authorization_endpoint:`${config.issuer}/authorize`,token_endpoint:`${config.issuer}/token`}),{headers:{'content-type':'application/json'}})).begin(),/pkce_required/);
});
