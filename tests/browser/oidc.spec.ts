import { generateKeyPair, SignJWT } from 'jose';
import { test, expect, type Page } from '@playwright/test';

const issuer='https://identity.example.test/realms/synthetic-shared';
const accessToken='synthetic-browser-access-token';

async function identityFixture(page:Page,baseURL:string,authenticatedStatus=200,initialStatus=401,assuranceError='mfa_required'){
  const origin=new URL(baseURL).origin;
  const config={enabled:true,issuer,clientId:'synthetic-preflight-console',redirectUri:`${origin}/`,allowInsecureLocal:true};
  const keys=await generateKeyPair('RS256');
  const authorizations:URL[]=[];
  let tokenRequests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/config'){await route.fulfill({json:config});return;}
    if(path==='/api/session'){
      const authenticated=route.request().headers()['authorization']===`Bearer ${accessToken}`;
      const status=authenticated?authenticatedStatus:initialStatus;
      await route.fulfill({status,json:status===200
        ? {subject:'synthetic-shared-user',tenantId:'synthetic-tenant',roles:['viewer'],applications:['funding-platform'],authMode:'jwt'}
        : {error:authenticated&&status===403?assuranceError:'synthetic_session_failure'}});
      return;
    }
    if(path==='/api/briefing'){await route.fulfill({json:{counts:{},missions:[],proposals:[],blocked:[],recentActivity:[],priorities:[]}});return;}
    await route.fulfill({status:404,json:{error:'synthetic_route_not_found'}});
  });
  await page.route(`${issuer}/**`,async route=>{
    const url=new URL(route.request().url());
    const headers={'access-control-allow-origin':origin};
    if(url.pathname.endsWith('/authorize')){
      authorizations.push(url);
      await route.fulfill({contentType:'text/html',body:'<h1>Synthetic identity provider</h1>'});return;
    }
    if(url.pathname.endsWith('/token')){
      tokenRequests++;
      const authorization=authorizations.at(-1)!;
      const body=new URLSearchParams(route.request().postData()??'');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code_verifier')).toBeTruthy();
      expect(body.has('client_secret')).toBe(false);
      const idToken=await new SignJWT({nonce:authorization.searchParams.get('nonce')})
        .setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience(config.clientId)
        .setSubject('synthetic-shared-user').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
      await route.fulfill({headers,json:{access_token:accessToken,token_type:'Bearer',expires_in:300,id_token:idToken}});return;
    }
    await route.fulfill({headers,json:{issuer,authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,
      jwks_uri:`${issuer}/keys`,response_types_supported:['code'],subject_types_supported:['public'],
      id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256']}});
  });
  return {
    authorizations,tokenRequests:()=>tokenRequests,
    callback:async(error?:string)=>{
      const state=authorizations.at(-1)!.searchParams.get('state')!;
      await page.goto(`${origin}/?${new URLSearchParams(error?{error,state}:{code:'synthetic-code',state})}`);
    },
  };
}

test('opening the console starts one PKCE login and permits an explicit retry after returning',async({page,baseURL})=>{
  const fixture=await identityFixture(page,baseURL!);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  expect(fixture.authorizations).toHaveLength(1);
  expect(fixture.authorizations[0]!.searchParams.get('code_challenge_method')).toBe('S256');
  expect(fixture.authorizations[0]!.searchParams.has('prompt')).toBe(false);
  await page.goto(baseURL!);
  await expect(page.getByRole('button',{name:'Se connecter avec OpenG7'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'Se connecter avec OpenG7'})).toBeVisible();
  expect(fixture.authorizations).toHaveLength(1);
  await page.getByRole('button',{name:'Se connecter avec OpenG7'}).click();
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  expect(fixture.authorizations).toHaveLength(2);
});

test('a denied callback stays local after reload without exchanging a token or restarting login',async({page,baseURL})=>{
  const fixture=await identityFixture(page,baseURL!);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  await fixture.callback('access_denied');
  await expect(page.getByRole('alert')).toContainText('La connexion n’a pas abouti');
  expect(new URL(page.url()).search).toBe('');
  await page.reload();
  await expect(page.getByRole('button',{name:'Se connecter avec OpenG7'})).toBeVisible();
  expect(fixture.authorizations).toHaveLength(1);
  expect(fixture.tokenRequests()).toBe(0);
});

test('an accepted OIDC callback refused by the API exposes explicit MFA recovery without a redirect loop',async({page,baseURL})=>{
  const fixture=await identityFixture(page,baseURL!,403);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  await fixture.callback();
  await expect(page.getByRole('alert')).toContainText('authentification multifacteur');
  expect(fixture.authorizations).toHaveLength(1);
  expect(fixture.tokenRequests()).toBe(1);
  expect(await page.evaluate(()=>[...Object.values(sessionStorage)].some(value=>value.includes('synthetic-browser-access-token')))).toBe(false);
  await page.getByRole('button',{name:'Se reconnecter avec MFA'}).click();
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  expect(fixture.authorizations).toHaveLength(2);
  expect(fixture.authorizations[1]!.searchParams.get('prompt')).toBe('login');
});

test('local password assurance recovery requests a fresh login without presenting an MFA requirement',async({page,baseURL})=>{
  const fixture=await identityFixture(page,baseURL!,403,401,'password_required');
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  await fixture.callback();
  await expect(page.getByRole('alert')).toContainText('connexion par mot de passe');
  expect(fixture.authorizations).toHaveLength(1);
  await expect(page.getByRole('button',{name:'Se reconnecter avec MFA'})).toHaveCount(0);
  await page.getByRole('button',{name:'Se reconnecter avec OpenG7'}).click();
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  expect(fixture.authorizations).toHaveLength(2);
  expect(fixture.authorizations[1]!.searchParams.get('prompt')).toBe('login');
});

test('successful login rearms SSO for reload and local logout prevents automatic reconnection',async({page,baseURL})=>{
  const fixture=await identityFixture(page,baseURL!);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  await fixture.callback();
  await expect(page.getByText('Session établie',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('preflight.oidc.autologin.v1'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Synthetic identity provider'})).toBeVisible();
  expect(fixture.authorizations).toHaveLength(2);
  await fixture.callback();
  await expect(page.getByText('Session établie',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Session',exact:true}).click();
  await page.getByRole('button',{name:'Déconnecter',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('button',{name:'Se connecter avec OpenG7'})).toBeVisible();
  expect(fixture.authorizations).toHaveLength(2);
  expect(await page.evaluate(()=>[...Object.values(sessionStorage)].some(value=>value.includes('synthetic-browser-access-token')))).toBe(false);
});

for(const status of [403,503]){
  test(`an initial API ${status} never triggers an automatic identity redirect`,async({page,baseURL})=>{
    const fixture=await identityFixture(page,baseURL!,200,status);
    await page.goto('/');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button',{name:'Se connecter avec OpenG7'})).toBeVisible();
    expect(fixture.authorizations).toHaveLength(0);
  });
}
