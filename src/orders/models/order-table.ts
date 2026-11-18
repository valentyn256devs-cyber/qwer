export const OrderTable = {
  TableName: 'Order',
  Fields: {
    ClientName: 'clientName',
    ClientPhone: 'clientPhone',
    ClientEmail: 'clientEmail',
    TelegramId: 'telegramId',
    Status: 'status',
    Service: 'service',
    /** Додаткові послуги, які клієнт обрав разом із основним замовленням */
    AdditionalServices: 'additionalServices',
    /** Коментар/побажання клієнта до замовлення */
    ClientComment: 'clientComment',
    ClientPhotos: 'clientPhotos',
    ReportPhotosBefore: 'reportPhotosBefore',
    ReportPhotosAfter: 'reportPhotosAfter',
    /** Фото кроків чек-листа: { [stepId]: string[] } */
    ChecklistPhotos: 'checklistPhotos',
    AdminComment: 'adminComment',
    BurialId: 'burialId',

    // Executor assignment
    AssignedExecutorId: 'assignedExecutorId',
    AssignedBy: 'assignedBy',
    AssignedAt: 'assignedAt',
    UnassignedAt: 'unassignedAt',
    UnassignedBy: 'unassignedBy',
    UnassignReason: 'unassignReason',

    // Dates / deadlines
    ServiceDateFrom: 'serviceDateFrom',
    ServiceDateTo: 'serviceDateTo',
    ExecutionDeadline: 'executionDeadline',

    // Lifecycle timestamps
    ConfirmedAt: 'confirmedAt',
    StartedAt: 'startedAt',
    SubmittedAt: 'submittedAt',
    CompletedAt: 'completedAt',
    CompletedBy: 'completedBy',
    CanceledAt: 'canceledAt',
    CanceledBy: 'canceledBy',
    CancellationReason: 'cancellationReason',
    CancellationComment: 'cancellationComment',
    PreviousStatus: 'previousStatus',
    CancellationRequestId: 'cancellationRequestId',

    // Executor comment
    ExecutorComment: 'executorComment',
  },
} as const;
