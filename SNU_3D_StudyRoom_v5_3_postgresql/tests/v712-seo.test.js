import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const server=readFileSync(new URL('server/index.js',root),'utf8');
const robots=readFileSync(new URL('robots.txt',root),'utf8');
const sitemap=readFileSync(new URL('sitemap.xml',root),'utf8');
const site='https://onlinestudy.maegongmae.com/';
test('public homepage metadata has consistent brand, title, canonical and discoverable description',()=>{
  const title='온라인스카 | 내 폰 속 서연고 도서관';
  assert.match(html,/<title>온라인스카 \| 내 폰 속 서연고 도서관<\/title>/);
  assert.match(html,/<meta name="description" content="[^\"]*서울대·연세대·고려대/);
  assert.match(html,/<link rel="canonical" href="https:\/\/onlinestudy\.maegongmae\.com\/"/);
  assert.match(html,/property="og:site_name" content="온라인스카"/);
  assert.match(html,/document\.title='온라인스카 \| 내 폰 속 서연고 도서관';/);
  assert.doesNotMatch(html,/document\.title=libraryMeta\.short/);
  assert.equal((html.match(/<title>/g)||[]).length,1);
});
test('site name structured data is valid JSON and points at canonical subdomain',()=>{
  const m=html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/);
  assert.ok(m);
  const data=JSON.parse(m[1]);
  assert.equal(data['@type'],'WebSite');
  assert.equal(data.name,'온라인스카');
  assert.equal(data.url,site);
  assert.equal(data.inLanguage,'ko-KR');
});
test('robots and sitemap both advertise only the public homepage',()=>{
  assert.match(robots,/User-agent: \*/);
  assert.match(robots,/Sitemap: https:\/\/onlinestudy\.maegongmae\.com\/sitemap\.xml/);
  assert.match(sitemap,/<loc>https:\/\/onlinestudy\.maegongmae\.com\/<\/loc>/);
  assert.equal((sitemap.match(/<loc>/g)||[]).length,1);
});
test('node static allowlist serves robots and sitemap using matching MIME types',()=>{
  assert.match(server,/\['\/robots\.txt','robots\.txt'\]/);
  assert.match(server,/\['\/sitemap\.xml','sitemap\.xml'\]/);
  assert.match(server,/application\/xml; charset=utf-8/);
  assert.match(server,/text\/plain; charset=utf-8/);
  assert.match(server,/\['\/assets\/guide\.jpg','assets\/guide\.jpg'\]/);
});
