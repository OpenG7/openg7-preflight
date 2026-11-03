import * as oauth from 'oauth4webapi';

export interface BrowserOidcConfig { enabled:boolean; issuer?:string; clientId?:string; redirectUri?:string; allowInsecureLocal?:boolean }
interface Flow {state:string;nonce:string;verifier:string;createdAt:number;issuer:string;clientId:string;redirectUri:string}
const storageKey='preflight.oidc.flow.v1';
type BrowserEnvironment={storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;currentUrl:()=>URL;redirect:(url:string)=>void;cleanCallback:()=>void};

export class BrowserOidcClient {
  constructor(readonly config:BrowserOidcConfig,private readonly browser:BrowserEnvironment,private readonly fetcher:typeof fetch=fetch){}
  private endpoint(value:string):URL{
    const url=new URL(value);
    const local=this.config.allowInsecureLocal&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!local)||url.username||url.password)throw new Error('oidc_endpoint_invalid');
    return url;
  }
  private async metadata(){
    if(!this.config.enabled||!this.config.issuer||!this.config.clientId||!this.config.redirectUri)throw new Error('oidc_not_configured');
    const issuer=this.endpoint(this.config.issuer);
    const options={signal:AbortSignal.timeout(10000),[oauth.customFetch]:this.fetcher,...(this.config.allowInsecureLocal?{[oauth.allowInsecureRequests]:true}:{})};
    const as=await oauth.processDiscoveryResponse(issuer,await oauth.discoveryRequest(issuer,options));
    if(!as.authorization_endpoint||!as.token_endpoint||!as.code_challenge_methods_supported?.includes('S256'))throw new Error('oidc_pkce_required');
    this.endpoint(as.authorization_endpoint);this.endpoint(as.token_endpoint);
    const redirect=this.endpoint(this.config.redirectUri);
    if(redirect.origin!==this.browser.currentUrl().origin||redirect.search||redirect.hash)throw new Error('oidc_redirect_origin_mismatch');
    return {as,client:{client_id:this.config.clientId},redirectUri:this.config.redirectUri,options};
  }
  async begin():Promise<void>{
    const {as,client,redirectUri}=await this.metadata();
    const state=oauth.generateRandomState(),nonce=oauth.generateRandomNonce(),verifier=oauth.generateRandomCodeVerifier();
    const flow:Flow={state,nonce,verifier,createdAt:Date.now(),issuer:this.config.issuer!,clientId:client.client_id,redirectUri};
    const url=this.endpoint(as.authorization_endpoint!);
    for(const [key,value] of Object.entries({client_id:client.client_id,redirect_uri:redirectUri,response_type:'code',scope:'openid profile',state,nonce,code_challenge_method:'S256',code_challenge:await oauth.calculatePKCECodeChallenge(verifier)}))url.searchParams.set(key,value);
    this.browser.storage.setItem(storageKey,JSON.stringify(flow));
    this.browser.redirect(url.href);
  }
  async resume():Promise<string|undefined>{
    const current=this.browser.currentUrl();
    if(!current.searchParams.has('code')&&!current.searchParams.has('error'))return undefined;
    const saved=this.browser.storage.getItem(storageKey);
    this.browser.storage.removeItem(storageKey);
    this.browser.cleanCallback();
    if(!saved)throw new Error('oidc_state_missing');
    let flow:Flow;
    try{flow=JSON.parse(saved) as Flow;}catch{throw new Error('oidc_state_invalid');}
    if(!flow.state||!flow.nonce||!flow.verifier||!Number.isFinite(flow.createdAt)||Date.now()-flow.createdAt>600000||flow.createdAt>Date.now()+30000||
      flow.issuer!==this.config.issuer||flow.clientId!==this.config.clientId||flow.redirectUri!==this.config.redirectUri||
      current.searchParams.get('state')!==flow.state)throw new Error('oidc_state_invalid');
    const expected=new URL(flow.redirectUri);
    if(current.origin!==expected.origin||current.pathname!==expected.pathname)throw new Error('oidc_redirect_mismatch');
    const {as,client,redirectUri,options}=await this.metadata();
    const params=oauth.validateAuthResponse(as,client,current,flow.state);
    const response=await oauth.authorizationCodeGrantRequest(as,client,oauth.None(),params,redirectUri,flow.verifier,{...options,signal:AbortSignal.timeout(10000)});
    const tokens=await oauth.processAuthorizationCodeResponse(as,client,response,{expectedNonce:flow.nonce,requireIdToken:true});
    return tokens.access_token;
  }
}
