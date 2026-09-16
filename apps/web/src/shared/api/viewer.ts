/**
 * Идентификатор вкладки. Симуляция на стенде одна на всех зрителей: `POST /api/sim` несет его
 * в заголовке `x-viewer-id`, сервер рассылает его вместе с новым состоянием, и вкладка
 * отличает свое изменение от чужого. Не сохраняется: две вкладки одного человека - два зрителя.
 */

function randomId(): string {
  // `randomUUID` есть только в защищенном контексте: по http с адреса в сети его нет.
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const VIEWER_ID = randomId();
