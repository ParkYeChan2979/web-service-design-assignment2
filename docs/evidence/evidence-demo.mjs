// 보고서 증거용 재현 스크립트 (제출 코드의 일부가 아님).
// 임시 DB로 실제 앱(createApp)을 띄우고 HTTP 요청을 보낸 뒤, 요청 전후의 DB 상태와 이력을 출력합니다.
// 실행: node docs/evidence/evidence-demo.mjs > docs/evidence/evidence-demo.txt
//  A. 정원 초과 직접 승인 거부 (409 CAPACITY_FULL) — 상태·승인 인원·이력 불변
//  B. 자동 승급 이력 저장 실패 주입 (T29와 같은 트리거) — 500, 신청 2건·이력 2건 전체 롤백, 이후 재시도 성공
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { openDb } from '../../src/db.js';
import { createApp } from '../../src/app.js';

const dir = mkdtempSync(join(tmpdir(), 'assignment2-evidence-'));
const db = openDb(join(dir, 'evidence.sqlite'));
const server = createApp({ db, secret: randomBytes(48).toString('hex') }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, token, body) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
const token = {};
for (const u of ['alice', 'bob', 'charlie', 'manager1', 'manager2']) token[u] = (await call('POST', '/api/auth/login', null, { username: u, password: 'Classroom123!' })).data.accessToken;

const apps = () => db.prepare('SELECT id,event_id,user_id,status FROM applications ORDER BY id').all();
const hist = () => db.prepare('SELECT id,application_id AS app,actor_id AS actor,action,from_status AS "from",to_status AS "to",reason,cause_history_id AS cause FROM application_history ORDER BY id').all();
const approved = ev => db.prepare("SELECT COUNT(*) AS n FROM applications WHERE event_id=? AND status='APPROVED'").get(ev).n;
const snap = () => ({ applications: apps(), history: hist() });
function table(title, rows) {
  console.log(`  ${title}`);
  if (!rows.length) { console.log('    (없음)'); return; }
  const keys = Object.keys(rows[0]);
  const w = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? 'null').length)));
  console.log('    ' + keys.map((k, i) => k.padEnd(w[i])).join(' | '));
  for (const r of rows) console.log('    ' + keys.map((k, i) => String(r[k] ?? 'null').padEnd(w[i])).join(' | '));
}
const show = (label, s) => { console.log(`\n[${label}]`); table('applications', s.applications); table('application_history', s.history); };
const req = (label, r) => console.log(`\n>>> ${label}\n<<< HTTP ${r.status} ${JSON.stringify(r.data)}`);

console.log('# 증거 재현 스크립트 실행 결과');
console.log(`# 실행 시각: ${new Date().toISOString()} / node ${process.version}`);
console.log('# 사용자 ID: alice=1, bob=2, manager1=3, manager2=4, charlie=5 · 행사 1 정원 2명(manager1), 행사 2 정원 1명(manager2)');

// ---------------------------------------------------------------- A
console.log('\n================ A. 정원 초과 직접 승인 거부 (행사 1, 정원 2명) ================');
const a1 = (await call('POST', '/api/events/1/applications', token.alice, {})).data;
const b1 = (await call('POST', '/api/events/1/applications', token.bob, {})).data;
const c1 = (await call('POST', '/api/events/1/applications', token.charlie, {})).data;
await call('POST', `/api/applications/${a1.id}/approve`, token.manager1, {});
await call('POST', `/api/applications/${b1.id}/approve`, token.manager1, {});
const beforeA = snap();
show(`요청 전 · 행사 1 승인 인원 ${approved(1)}/2`, beforeA);
const rA = await call('POST', `/api/applications/${c1.id}/approve`, token.manager1, {});
req(`POST /api/applications/${c1.id}/approve  (actor: manager1 #3, 대상: charlie의 PENDING 신청 #${c1.id})`, rA);
const afterA = snap();
show(`요청 후 · 행사 1 승인 인원 ${approved(1)}/2`, afterA);
console.log(`\n=> 요청 전후 applications·application_history 완전히 동일: ${isDeepStrictEqual(beforeA, afterA)}`);

// ---------------------------------------------------------------- B
console.log('\n================ B. 자동 승급 이력 저장 실패 주입 → 전체 롤백 (행사 2, 정원 1명) ================');
const a2 = (await call('POST', '/api/events/2/applications', token.alice, {})).data;
await call('POST', `/api/applications/${a2.id}/approve`, token.manager2, {});
const b2 = (await call('POST', '/api/events/2/applications', token.bob, {})).data;
db.exec("CREATE TRIGGER fail_auto BEFORE INSERT ON application_history WHEN NEW.action='AUTO_APPROVE' BEGIN SELECT RAISE(ABORT,'TEST_INJECTED_FAILURE'); END");
console.log("\n트리거 설치: AUTO_APPROVE 이력 INSERT 시 RAISE(ABORT,'TEST_INJECTED_FAILURE')  (테스트 T29와 동일)");
const beforeB = snap();
show(`요청 전 · 행사 2 승인 인원 ${approved(2)}/1`, beforeB);
const rB = await call('POST', `/api/applications/${a2.id}/revoke`, token.manager2, { reason: '운영 사정으로 승인 취소' });
req(`POST /api/applications/${a2.id}/revoke {"reason":"운영 사정으로 승인 취소"}  (actor: manager2 #4)`, rB);
const afterB = snap();
show(`요청 후 · 행사 2 승인 인원 ${approved(2)}/1`, afterB);
console.log(`\n=> 요청 전후 applications·application_history 완전히 동일: ${isDeepStrictEqual(beforeB, afterB)}`);
console.log('   (REVOKED 변경·REVOKE 이력·APPROVED 변경이 이미 실행된 뒤 마지막 INSERT가 실패했지만 모두 되돌려짐)');
db.exec('DROP TRIGGER fail_auto');
console.log('\n트리거 제거 후 같은 요청 재시도');
const rB2 = await call('POST', `/api/applications/${a2.id}/revoke`, token.manager2, { reason: '운영 사정으로 승인 취소' });
req(`POST /api/applications/${a2.id}/revoke (재시도)`, { status: rB2.status, data: { revoked: { id: rB2.data.revoked?.id, status: rB2.data.revoked?.status }, promoted: rB2.data.promoted && { id: rB2.data.promoted.id, status: rB2.data.promoted.status } } });
show(`재시도 후 · 행사 2 승인 인원 ${approved(2)}/1`, snap());

await new Promise(r => server.close(r)); db.close(); rmSync(dir, { recursive: true, force: true });
