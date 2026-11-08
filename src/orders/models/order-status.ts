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

/** Req 43: Executor reports inability to complete the order */
export enum ExecutorInabilityReason {
  CannotFindGrave = 'cannot_find_grave',
  NoAccess = 'no_access',
  WeatherConditions = 'weather_conditions',
  HealthIssue = 'health_issue',
  WrongLocation = 'wrong_location',
  SafetyIssue = 'safety_issue',
  MissingInformation = 'missing_information',
  Other = 'other',
}

export const ExecutorInabilityReasonLabels: Record<ExecutorInabilityReason, string> = {
  [ExecutorInabilityReason.CannotFindGrave]: 'Не можу знайти могилу',
  [ExecutorInabilityReason.NoAccess]: 'Немає доступу',
  [ExecutorInabilityReason.WeatherConditions]: 'Погодні умови',
  [ExecutorInabilityReason.HealthIssue]: 'Проблема зі здоровʼям',
  [ExecutorInabilityReason.WrongLocation]: 'Невірна локація',
  [ExecutorInabilityReason.SafetyIssue]: 'Питання безпеки',
  [ExecutorInabilityReason.MissingInformation]: 'Недостатньо інформації',
  [ExecutorInabilityReason.Other]: 'Інше',
};

/** Reasons that require a mandatory comment from executor (req 43) */
export const ExecutorInabilityReasonsRequiringComment: ExecutorInabilityReason[] = [
  ExecutorInabilityReason.Other,
  ExecutorInabilityReason.WrongLocation,
  ExecutorInabilityReason.MissingInformation,
];
