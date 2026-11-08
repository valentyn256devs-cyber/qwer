export enum OrderStatus {
  New = 'new',
  AwaitingAdminReview = 'awaiting_admin_review',
  Confirmed = 'confirmed',
  AvailableForExecutor = 'available_for_executor',
  Assigned = 'assigned',
  AwaitingClientConfirmation = 'awaiting_client_confirmation',
  InProgress = 'in_progress',
  AwaitingCompletionReview = 'awaiting_completion_review',
  RevisionRequired = 'revision_required',
  Done = 'done',
  Rejected = 'rejected',
  Canceled = 'canceled',
  OnHold = 'on_hold',
  PendingClarification = 'pending_clarification',
}

export enum UnassignReason {
  IllnessUnavailable = 'illness_unavailable',
  ExecutorRequestedReassignment = 'executor_requested_reassignment',
  MissedDeadline = 'missed_deadline',
  QualityIssue = 'quality_issue',
  AdminDecision = 'admin_decision',
  Other = 'other',
}

export const UnassignReasonLabels: Partial<Record<UnassignReason, string>> = {
  [UnassignReason.IllnessUnavailable]: 'Хвороба / неможливості',
  [UnassignReason.ExecutorRequestedReassignment]: 'Виконавець просив перепризначити',
  [UnassignReason.MissedDeadline]: 'Пропущений термін',
  [UnassignReason.QualityIssue]: 'Проблема з якістю',
  [UnassignReason.AdminDecision]: 'Рішення адміністратора',
  [UnassignReason.Other]: 'Інше',
};
