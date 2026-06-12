export enum PerformerStatus {
  PENDING= 'pending',     // Анкету заповнено, чекає на модерацію адміном
ACTIVE  = 'active',    // Схвалено, отримує замовлення
INACTIVE = 'inactive',    // Тимчасово вимкнув режим роботи
BANNED = 'banned'      // Заблокований за порушення
}
