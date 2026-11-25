import { AppError, missing, forbidden, invalidState } from './errors.js';

// 업무 규칙과 트랜잭션 구현 (TODO-01~04). 계약은 docs/API.md를 따릅니다.
// actor는 검증된 로그인 사용자입니다. repo의 저장 함수는 권한을 검사하지 않으므로
// 모든 권한·상태·정원 판단은 이 파일에서 트랜잭션 안의 최신 DB 값으로 합니다.

const alreadyApplied = () => new AppError(409,'ALREADY_APPLIED','이미 이 행사에 신청한 기록이 있습니다.');
const capacityFull = () => new AppError(409,'CAPACITY_FULL','승인 정원이 모두 찼습니다.');

// SQLite UNIQUE(event_id,user_id) 위반인지 판별합니다 (SQLITE_CONSTRAINT_UNIQUE = 2067).
function isUniqueViolation(e) {
  return e?.errcode===2067 || /UNIQUE constraint failed/.test(e?.message ?? '');
}

// 한 요청의 모든 조회·검사·저장을 하나의 트랜잭션으로 실행합니다.
// BEGIN IMMEDIATE: 시작 시점에 쓰기 잠금을 잡아, 검사(읽기)와 저장(쓰기) 사이에
// 다른 연결(다른 서버 프로세스 포함)이 끼어들지 못하게 합니다. 잠금 대기는 db.js의 busy_timeout(5000ms).
// fn이 정상 반환하면 COMMIT, 업무 거부(AppError)든 저장 오류든 예외가 나면 ROLLBACK 후 다시 던집니다.
function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result=fn();
    db.exec('COMMIT');
    return result;
  } catch(e) {
    if(db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

// 신청의 행사를 담당하는 운영자인지 확인합니다.
function isManagerOf(actor,event) {
  return actor.role==='MANAGER' && event.managerId===actor.id;
}

export function createApplicationService(repo) {
  const { db }=repo;
  return {
    // TODO-01 신청: 행사 존재(404) → 학생 역할(403) → 중복(409) → PENDING 저장 + APPLY 이력.
    apply(actor,eventId) {
      return inTransaction(db,()=>{
        const event=repo.event(eventId);
        if(!event) throw missing('행사');
        if(actor.role!=='STUDENT') throw forbidden();
        // CANCELLED·REVOKED를 포함해 상태와 관계없이 기존 신청이 있으면 중복입니다.
        if(repo.existing(eventId,actor.id)) throw alreadyApplied();
        let application;
        try { application=repo.insert(eventId,actor.id); }
        catch(e) { if(isUniqueViolation(e)) throw alreadyApplied(); throw e; } // UNIQUE는 최종 방어선
        repo.addHistory({applicationId:application.id,actorId:actor.id,action:'APPLY',fromStatus:null,toStatus:'PENDING'});
        return application;
      });
    },

    // TODO-02 대기 취소: 신청 존재(404) → 본인(403) → PENDING(409) → CANCELLED + CANCEL 이력.
    // 대기 취소는 승인 자리를 비우지 않으므로 자동 승급하지 않습니다.
    cancel(actor,applicationId) {
      return inTransaction(db,()=>{
        const application=repo.application(applicationId);
        if(!application) throw missing('신청');
        if(actor.role!=='STUDENT' || application.userId!==actor.id) throw forbidden();
        if(application.status!=='PENDING') throw invalidState(); // APPROVED 직접 취소·재취소 거부
        const updated=repo.setStatus(application.id,'CANCELLED');
        repo.addHistory({applicationId:application.id,actorId:actor.id,action:'CANCEL',fromStatus:'PENDING',toStatus:'CANCELLED'});
        return updated;
      });
    },

    // TODO-03 직접 승인: 신청 존재(404) → 담당 운영자(403) → PENDING(409) → 정원(409) → APPROVED + APPROVE 이력.
    // 운영자가 PENDING 중 고르므로 FIFO를 강제하지 않습니다 (FIFO는 자동 승급에만 적용).
    approve(actor,applicationId) {
      return inTransaction(db,()=>{
        const application=repo.application(applicationId);
        if(!application) throw missing('신청');
        const event=repo.event(application.eventId);
        if(!isManagerOf(actor,event)) throw forbidden();
        if(application.status!=='PENDING') throw invalidState();
        if(repo.approvedCount(event.id)>=event.capacity) throw capacityFull(); // APPROVED만 정원에 포함
        const updated=repo.setStatus(application.id,'APPROVED');
        repo.addHistory({applicationId:application.id,actorId:actor.id,action:'APPROVE',fromStatus:'PENDING',toStatus:'APPROVED'});
        return updated;
      });
    },

    // TODO-04 승인 취소: 신청 존재(404) → 담당 운영자(403) → APPROVED(409)
    // → REVOKED + REVOKE 이력 → 같은 행사 대기자 1명 AUTO_APPROVE + 원인 연결 이력.
    // 신청 2건 + 이력 2건이 하나의 트랜잭션이므로 어느 저장이 실패해도 전부 롤백됩니다.
    // reason은 app.js에서 trim·길이(5~200자) 검사를 마친 값입니다.
    revoke(actor,applicationId,reason) {
      return inTransaction(db,()=>{
        const application=repo.application(applicationId);
        if(!application) throw missing('신청');
        const event=repo.event(application.eventId);
        if(!isManagerOf(actor,event)) throw forbidden();
        if(application.status!=='APPROVED') throw invalidState(); // 반복 승인 취소 거부

        const revoked=repo.setStatus(application.id,'REVOKED');
        const revokeHistoryId=repo.addHistory({applicationId:application.id,actorId:actor.id,action:'REVOKE',fromStatus:'APPROVED',toStatus:'REVOKED',reason});

        // 요청당 최대 1명만 승급합니다. 기존 빈자리가 더 있어도 추가로 채우지 않습니다.
        // 방어적 정원 확인: 방금 1자리가 비었으므로 정상 데이터에서는 항상 참입니다.
        let promoted=null;
        const next=repo.nextPending(event.id);
        if(next && repo.approvedCount(event.id)<event.capacity) {
          promoted=repo.setStatus(next.id,'APPROVED');
          // AUTO_APPROVE의 행위자는 승인 취소를 요청한 운영자, 원인은 이 요청의 REVOKE 이력입니다.
          repo.addHistory({applicationId:next.id,actorId:actor.id,action:'AUTO_APPROVE',fromStatus:'PENDING',toStatus:'APPROVED',causeHistoryId:revokeHistoryId});
        }
        return {revoked,promoted};
      });
    }
  };
}
