export const ExecutorConst = {
  OpenOrdersLoading: '📋 Відкриті замовлення. Завантаження...',
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
  WaitingForAdminButton: '⏳ Очікує підтвердження адміністратора',
  RespondClarificationButton: '💬 Відповісти на уточнення',
  ProposeUpdateButton: '🔄 Запропонувати оновлення Memory Place',
  ClarifyButton: '❓ Запросити уточнення',
  ReportProblemButton: '⚠️ Повідомити про проблему',
  CannotCompleteButton: '❌ Не можу виконати замовлення',
  SubmitButton: '📤 Надіслати роботу на перевірку',
  ConfirmSelfcheckButton: '✅ Підтверджую, що всі роботи виконані',
  NextChecklistButton: '➡️ Далі — Service Checklist',
  SendForReviewButton: '📤 Відправити на перевірку',
  GoSubmitButton: '📤 Надіслати роботу на перевірку',
  SkipCommentButton: '⏭️ Пропустити коментар',
  ArrivedButton: '✅ Підтверджую прибуття',
  SelfcheckButton: '🔍 Фінальна self-check',
  PhotoUploadHint: '📸 Надішліть фото (одне або кілька разом):',
  PhotoUploadAfter: '📸 Надішліть фото «після» (одне або кілька разом):',
  PhotoSaved: (count: number) =>
    `✅ Фото збережено (${count}). Надішліть ще або оберіть дію нижче.`,
  PhotoSaveError: '❌ Не вдалося зберегти фото. Спробуйте надіслати ще раз.',
  PhotoNotPhoto: '📸 Будь ласка, надішліть саме фото (не текст/файл).',
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
  MyOrdersStartError: (message: string) => `❌ ${message}`,

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

  // ==================== Загальні кнопки / повідомлення ====================
  CancelButton: '↩️ Скасувати',
  SendButton: '✅ Надіслати',
  SkipPhotosButton: '⏭ Надіслати без фото',
  SendErrorMessage: 'Не вдалося надіслати повідомлення.',
  PlaceholderActionHint: 'Ця дія буде реалізована найближчим часом.',

  // ==================== Req 43: Не можу виконати ====================
  CannotCompleteTitle: '❌ <b>Не можу виконати замовлення</b>\n\nОберіть причину:',
  CannotCompletePickHint:
    'Будь ласка, відкрийте замовлення з розділу «Мої замовлення» та натисніть «Не можу виконати замовлення».',
  InabilityCommentPrompt: '✍️ Будь ласка, додайте коментар (обовʼязково для обраної причини):',
  InabilitySentSuccess:
    '✅ <b>Повідомлення надіслано адміністратору.</b>\nЗамовлення повернуто у відкриті для перепризначення.',

  // ==================== Req 48: Повідомити про проблему ====================
  ReportProblemPickHint:
    'Відкрийте замовлення з розділу «Мої замовлення» та натисніть «Повідомити про проблему».',
  ReportProblemTitle: '🆘 <b>Повідомити про проблему</b>\n\nОберіть причину:',
  ProblemCommentPrompt:
    '✍️ Опишіть проблему (коментар). Після коментаря ви зможете додати фото (необовʼязково) або натиснути «Надіслати».',
  ProblemPhotosPrompt:
    '📷 Надішліть фото (необовʼязково) або натисніть «Надіслати без фото». Коли закінчите — натисніть «Надіслати».',
  ProblemPhotoAdded: (count: number) =>
    `📷 Фото додано (${count}). Надішліть ще або натисніть «Надіслати».`,
  ProblemSentSuccess:
    '✅ Повідомлення про проблему надіслано адміністратору. Статус замовлення не змінено.',
  NoActiveProblemReport: 'Немає активного звіту про проблему.',

  // ==================== Картка деталей замовлення (executor-order-view) ====================
  OrderDetailsOverdue: '🔴 <b>ПРОСТРОЧЕНО</b>',
  OrderDetailsServiceLabel: '📌 <b>Послуга:</b>',
  OrderDetailsAdditionalServicesLabel: '➕ <b>Додаткові послуги:</b>',
  OrderDetailsDateLabel: '📅 <b>Дата виконання:</b>',
  OrderDetailsDeadlineLabel: '⏰ <b>Виконати до:</b>',
  OrderDetailsStatusLabel: '📊 <b>Статус:</b>',
  OrderDetailsClientCommentLabel: '💬 <b>Коментар клієнта:</b>',
  OrderDetailsClientLabel: '👤 <b>Клієнт:</b>',
  OrderDetailsClientNameLabel: '  • Ім\'я:',
  OrderDetailsClientPhoneLabel: '  • Телефон:',
  OrderDetailsLocationLabel: '📍 <b>Місце виконання:</b>',
  OrderDetailsCemeteryLabel: '  • Кладовище:',
  OrderDetailsSectorLabel: '  • Сектор / ряд / номер:',
  OrderDetailsGpsLabel: '  • GPS:',
  OrderDetailsFullNameLabel: '  • ПІБ:',
  OrderListButtonFormat: (id: string, service: string, status: string) =>
    `№${id} · ${service} · ${status}`,
  OrderListButtonFormatShort: (id: string, service: string) => `№${id} · ${service}`,
  OrderDetailsRemaining: (remaining: string) => ` (залишилось: ${remaining})`,

  // ==================== Картка відкритого замовлення (open-orders.scene) ====================
  OpenOrdersCardTitle: (id: string) => `📌 <b>Замовлення №${id}</b>`,
  OpenOrdersCardServiceLabel: '🏷 Послуга:',
  OpenOrdersCardAddressLabel: '📍 Адреса / кладовище:',
  OpenOrdersCardDateLabel: '📅 Бажана дата:',
  OpenOrdersCardDeadlineLabel: '⏰ Виконати до:',
  OpenOrdersCardRemainingLabel: '⏱ Залишилось:',
  OpenOrdersCardCommentLabel: '📝 Коментар:',
  OpenOrdersCardAddressHint: 'див. картку',
  OpenOrdersCardDash: '—',

  // ==================== Сповіщення виконавцю про нове замовлення ====================
  NewOrderTitle: (id: string) => `🆕 <b>Нове замовлення №${id}</b>`,
  NewOrderServiceLabel: '📌 <b>Послуга:</b>',
  NewOrderAdditionalServicesLabel: '➕ <b>Додаткові послуги:</b>',
  NewOrderDateLabel: '📅 <b>Дата виконання:</b>',
  NewOrderDeadlineLabel: '⏰ <b>Виконати до:</b>',
  NewOrderDeceasedLabel: '⚰️ <b>Покійний:</b>',
  NewOrderLifeYearsLabel: '🎂 <b>Роки життя:</b>',
  NewOrderPlaceLabel: '📍 <b>Місце виконання:</b>',
  NewOrderCemeteryLabel: '  • Кладовище:',
  NewOrderSectorLabel: '  • Сектор / ряд / номер:',
  NewOrderGpsLabel: '  • GPS:',
  NewOrderCommentLabel: '💬 <b>Коментар клієнта:</b>',
  NewOrderConfirmButton: '✅ Взяти в роботу',
  NewOrderDeclineButton: '🚫 Відмовитись',
  NewOrderDash: '—',
  NewOrderNoAdditionalServices: '—',
  NewOrderNoComment: '—',
  NewOrderConfirmedByMe: (id: string) =>
    `✅ <b>Ви підтвердили замовлення №${id}</b>\n\nВоно з’явилося у розділі «Мої замовлення».`,
  NewOrderDeclinedByMe: (id: string) =>
    `🚫 <b>Ви відмовились від замовлення №${id}</b>`,
  NewOrderTakenByOther: (id: string) =>
    `🔒 <b>Замовлення №${id} вже підтверджено іншим виконавцем</b>`,
  NewOrderConfirmError: '❌ Не вдалося підтвердити замовлення. Спробуйте пізніше.',
  NewOrderAlreadyTaken: '❌ <b>Замовлення вже підтверджено іншим виконавцем.</b>',
  // Сповіщення замовнику (клієнту) — лише текст, без додаткових даних
  ClientOrderTaken: (orderId: string) => `✅ Ваше замовлення (№${orderId}) прийнято виконавцем.`,
};