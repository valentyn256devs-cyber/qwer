export const ExecutorConst = {
  OpenOrdersLoading: '📋 Відкриті замовлення (AvailableForExecutor). Завантаження...',
  OpenOrdersEmpty: 'Наразі немає відкритих замовлень.',
  OpenOrdersError: '❌ Не вдалося завантажити відкриті замовлення.',
  OpenOrdersFooter: '⬇️ Оберіть дію для обраного замовлення:',
  OrderNotFound: '❌ Не вдалося отримати ID замовлення.',
  OrderNotFoundAssigned: '❌ Замовлення не знайдено або не призначено вам.',
  OrderNotFoundSimple: '❌ Замовлення не знайдено.',
  AcceptLoading: '✅ Прийняття замовлення. Перевірка доступності...',
  AcceptSuccess: (id: string, service: string) =>
    `✅ <b>Ви успішно прийняли замовлення №${id}!</b>\n\n📌 Послуга: <b>${service}</b>`,
  AcceptConflict:
    '❌ <b>Замовлення вже було прийняте іншим виконавцем.</b>\n\n' +
    'Не допускається ситуація, коли одне замовлення одночасно отримують два виконавця. ' +
    'Перейдіть до списку відкритих замовлень і оберіть інше.',
  AcceptError: '❌ Не вдалося прийняти замовлення. Спробуйте пізніше.',
  EmptyChecklist: '✅ Service Checklist порожній. Пройдіть до фінальної перевірки:',
  SubmitPrompt:
    '📤 <b>Надіслати роботу на перевірку</b>\n\n' +
    'Додайте коментар виконавця (необов\'язково) або натисніть "Пропустити":',
  BackToMenu: '↩️ Назад до меню',
  BackToOrders: '↩️ Назад до списку',
  BackToDetails: '↩️ Назад',
  BackToChecklist: '↩️ Назад',
  BackToSelfcheck: '↩️ Назад',
  ViewButton: '👁 Переглянути',
  TakeButton: '✅ Взяти замовлення',
  StartButton: '▶️ Почати',
  ProposeUpdateButton: '🔄 Запропонувати оновлення Memory Place',
  ClarifyButton: '❓ Запросити уточнення',
  ReportProblemButton: '⚠️ Повідомити про проблему',
  CannotCompleteButton: '❌ Не можу виконати замовлення',
  SubmitButton: '📤 Надіслати роботу на перевірку',
  ConfirmSelfcheckButton: '✅ Підтверджую, що всі роботи виконані',
  NextChecklistButton: '➡️ Далі — Service Checklist',
  GoSubmitButton: '📤 Надіслати роботу на перевірку',
  SkipCommentButton: '⏭️ Пропустити коментар',
  ArrivedButton: '✅ Підтверджую прибуття',
  SelfcheckButton: '🔍 Фінальна self-check',
  PhotoUploadHint: '📸 Надішліть фото (одне або кілька разом):',
  PhotoUploadAfter: '📸 Надішліть фото «після» (одне або кілька разом):',
  HelpPrompt: '🆘 Оберіть причину проблеми...',
  ProblemButton: '📝 Повідомити про проблему',
  CannotCompleteHelpButton: '❌ Не можу виконати замовлення',
  ChooseAction: '👇 Оберіть дію:',
  Welcome: '👋 Ласкаво просимо до бота виконавця! Оберіть дію з меню нижче:',
  ContinueWorkButton: '🔧 Продовжити роботу',
  ContinueWorkMessage: '🔧 Продовжуйте роботу над замовленням. Усі зміни робляться як звичайно.',
  RevisionPrompt: '🔄 <b>Замовлення потребує ревізії</b>\n\nКоментар адміністратора:',
  BackToMenuMessage: '↩️ Повернення до головного меню.',

  // ==================== Req: «Мої замовлення» (MY_ORDERS_SCENE) ====================
  MyOrdersLoading: '💼 <b>Мої замовлення</b>\n\nЗавантаження...',
  MyOrdersEmpty:
    '📭 <b>У вас немає активних замовлень.</b>\n\n' +
    'Активні замовлення з’являться тут після того, як адміністратор призначить їх вам.',
  MyOrdersError: '❌ Не вдалося завантажити ваші замовлення. Спробуйте пізніше.',
  MyOrdersTitle: (count: number) =>
    `💼 <b>Мої активні замовлення (${count})</b>\n\nОберіть замовлення, щоб переглянути деталі:`,
  MyOrdersRefreshButton: '🔄 Оновити список',
  MyOrdersBackButton: '↩️ Назад до списку',
  MyOrdersDetailsTitle: (id: string) => `📄 <b>Замовлення №${id}</b>`,
  MyOrdersContinueButton: '▶️ Продовжити роботу',
  MyOrdersStartButton: '▶️ Почати виконання',
  MyOrdersRevisionButton: '🔄 Перейти до доробки',
  MyOrdersStarted: '✅ <b>Замовлення взято в роботу.</b>\n\nПереходимо до виконання.',
  MyOrdersAwaitingReview:
    '⏳ <b>Замовлення очікує на перевірку.</b>\n\nВиконавець не може змінювати замовлення на цьому етапі — очікуйте рішення адміністратора.',
  MyOrdersPendingClarification:
    '❓ <b>Замовлення очікує на уточнення.</b>\n\nДочекайтесь відповіді адміністратора або клієнта.',
  MyOrdersOnHold:
    '⏸ <b>Замовлення призупинено.</b>\n\nЗв’яжіться з адміністратором для уточнення подальших дій.',
  MyOrdersCannotContinue:
    'ℹ️ На цьому етапі замовлення не потребує дій з вашого боку. Перегляньте деталі та очікуйте оновлень.',
  MyOrdersNoAdditionalServices: '—',
  MyOrdersNoClientComment: '—',

  // ==================== Req: «Виконані замовлення» (DONE_ORDERS_SCENE) ====================
  DoneOrdersLoading: '✅ <b>Виконані замовлення</b>\n\nЗавантаження...',
  DoneOrdersEmpty:
    '📭 <b>У вас немає виконаних замовлень.</b>\n\n' +
    'Завершені замовлення з’являться тут після прийняття роботи адміністратором.',
  DoneOrdersError: '❌ Не вдалося завантажити виконані замовлення. Спробуйте пізніше.',
  DoneOrdersTitle: (count: number) =>
    `✅ <b>Виконані замовлення (${count})</b>\n\nОберіть замовлення, щоб переглянути деталі:`,
  DoneOrdersPageIndicator: (page: number, totalPages: number) =>
    `📄 Сторінка ${page} / ${totalPages}`,
  DoneOrdersPrevButton: '◀️ Назад',
  DoneOrdersNextButton: 'Далі ▶️',
  DoneOrdersCancelButton: '✖️ Скасувати перегляд',
  DoneOrdersDetailsTitle: (id: string) => `📄 <b>Виконане замовлення №${id}</b>`,
  DoneOrdersCompletedLabel: '✅ <b>Завершено:</b>',
};