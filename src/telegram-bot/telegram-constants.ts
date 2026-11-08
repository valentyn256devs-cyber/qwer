import {Context, Markup} from "telegraf";
import {OrderStatus} from "../orders/models/order-status";

export const TelegramBot = {
  ClientBot: 'TelegramClient',
  AdminBot: 'TelegramAdmin',
} as const;

export const Scene = {
  CREATE_ORDER_WIZARD: 'CREATE_ORDER_WIZARD',
  CREATE_BURIAL_WIZARD: 'CREATE_BURIAL_WIZARD',
  EDIT_BURIAL_WIZARD: 'EDIT_BURIAL_WIZARD',
  CREATE_PERFORMER_WIZARD: 'CREATE_PERFORMER_WIZARD',
  OPEN_ORDERS_SCENE: 'OPEN_ORDERS_SCENE',
  MY_ORDERS_SCENE: 'MY_ORDERS_SCENE',
  DONE_ORDERS_SCENE: 'DONE_ORDERS_SCENE',
  ACCEPT_ORDER_SCENE: 'ACCEPT_ORDER_SCENE',
  ORDER_DETAILS_SCENE: 'ORDER_DETAILS_SCENE',
  SEARCH_VERIFY_SCENE: 'SEARCH_VERIFY_SCENE',
  BEFORE_PHOTOS_SCENE: 'BEFORE_PHOTOS_SCENE',
  AFTER_PHOTOS_SCENE: 'AFTER_PHOTOS_SCENE',
  SERVICE_CHECKLIST_SCENE: 'SERVICE_CHECKLIST_SCENE',
  FINAL_SELFCHECK_SCENE: 'FINAL_SELFCHECK_SCENE',
  SUBMIT_SCENE: 'SUBMIT_SCENE',
} as const;

export const OrderStepUa = {
  Loading: '🔄 Завантажую доступні послуги...',
  NoServices: 'Наразі немає доступних послуг. Спробуйте пізніше.',
  ErrorLoadServices: 'Помилка завантаження послуг.',
  SelectRole: '👤 Виберіть роль: клієнт або виконавець',
  Service: 'Послуга',
  FillCard: 'Зараз необхідно заповнити картку поховання (ПІБ, дати тощо)...',
  ChooseService: 'Будь ласка, оберіть послугу зі списку вище, натиснувши на кнопку.',
  ChooseMenu: 'Будь ласка, оберіть один з варіантів на клавіатурі меню.',
  // SendYourLocation: 'Надішліть, будь ласка, локацію (кнопка Скріпка -> Локація):',
  SendYourLocation: 'Надішліть, будь ласка, локацію:\n\n📌 <b>кнопка Скріпка 📎 ➔ Локація</b>',
  SendMyLocation: 'Надіслати мою поточну геолокацію',
  SendCorrectLocation: 'Будь ласка, надішліть коректні дані локації.',
  IncorrectLocationFormat: 'Некоректний формат. Будь ласка, надішліть локацію або текст.',

  GoBack: '⬅️ Повернутися назад',
  Skip: 'Пропустити ➡️',
  Cancel: '❌ Скасувати',
  NoSet: 'Не вказано',
  Approve: '✅ Підтвердити',
  Reject: '❌ Відхилити',
  ApproveAndCreate: '✅ Створити замовлення',
  Order: '🛍 Замовити',
  BackToList: '🔙 Назад до списку',
  Edit: '✏️ Редагувати дані',

  HintSetOrientation: 'Будь ласка, введіть текст орієнтирів або натисніть кнопку "Пропустити".',
  SendMyPhone: '📱 Поділитися номером телефону',
  ErrorSetPhone: 'Будь ласка, натисніть кнопку або введіть номер телефону вручну.',
  SavingOrder: '⏳ Зберігаю вашу заявку у хмарі...',
  ErrorSavingOrder: 'Помилка сервера під час створення заявки. Спробуйте пізніше.',
  OrderCanceled: 'Скасовано. Ви можете розпочати заново за допомогою головного меню.',
  HintChooseMenu: 'Будь ласка, оберіть дію на інлайн-кнопках вище.',
  SuccessSavedOrder: '🚀 Картку успішно відправлено адмін-ботом!',
  ErrorSavedOrder: '❌ Помилка відправки через адмін-бота:',
  MainMenu: 'Головне меню:',

  InitOrder: '⏳ Ініціалізую оформлення замовлення...',
  LoadingServices: '🔄 Завантажую список актуальних послуг...',
  ErrorLoadingServices: 'Сталася помилка при отриманні списку послуг. Спробуйте пізніше.',
  EmptyServices: 'У вас ще немає створених замовлень.',

  HintHelp: 'Якщо ви хочете подати заявку або дізнатися статус, використовуйте меню команд (натисніть /start).',
  GetMessage: 'Отримано повідомлення:',

  YourOrders: '<b>Ваші замовлення:</b>\n\n',
  Welcome: 'Вітаємо у сервісі <b>ДОГЛЯД+</b> 🕊\nМи допоможемо дистанційно піклуватися про місця пам’яті.',

  AdminWelcome: '🛡️ <b>Панель адміністратора ДОГЛЯД+</b>\n\n',
  AdminWelcomeDescription: 'Сюди надходитимуть нові заявки від клієнтів. Ви зможете керувати їхніми статусами за допомогою інлайн-кнопок під картками замовлень.',
  HintBurialLocation: '✍️ <b>Вкажіть довільну назву для цього місця поховання:</b>\n<i>(Наприклад: "Могила дідуся", "Сімейне місце")</i>',
  HintBurialLastName: '✍️ Крок 2.1. <b>Введіть Прізвище померлого:</b>',
  HintBurialName: '✍️ Крок 2.2. <b>Введіть Ім’я померлого:</b>',
  HintBurialFatherName: '✍️ Крок 2.3. <b>Введіть По батькові померлого:</b>',
  HintBurialDateBirthday: '📅 Крок 2.4. <b>Введіть дату народження померлого у форматі ДД.ММ.РРРР:</b>\n<i>(Або натисніть кнопку "Пропустити ➡️")</i>',
  HintBurialDateDied: '📅 Крок 2.5. <b>Введіть дату смерті померлого у форматі ДД.ММ.РРРР:</b>\n<i>(Або натисніть кнопку "Пропустити ➡️")</i>',
  // HintBurialPlaceLocation: '🏛 <b>Вкажіть назву кладовища, сектор або населений пункт:</b>',

  HintBurialDateMMYYYY: '📅 <b>Введіть хоча б місяць та рік у форматі ММ.РРРР:</b>\n',

  HintGoogleMap: '✍️ <b>Надішліть посилання на Google Maps:</b>',
  HintFullLocation: '✍️ <b>Введіть повний опис місця</b> (Область, Населений пункт, Цвинтар, Сектор/Ряд/Номер):',
  HintDescriptionBurialPlace: '📌 <b>Опишіть візуальні орієнтири поблизу поховання:</b>\n' +
    '(наприклад: "біля великого дуба", "сектор 4, третій ряд від дороги", "поруч із червоним парканом").\n\n' +
    '<i>Цей крок не є обов’язковим, ви можете його пропустити, натиснувши кнопку нижче.</i>',

  ServicesCatalog: '📋 <b>Каталог послуг сервісу ДОГЛЯД+:</b>\n\n',
  GenerateOrder: '👇 <b>Натисніть на послугу нижче, щоб оформити замовлення:</b>',

  HintAdminFeedbackHelp: '🕊 <b>Сервіс ДОГЛЯД+</b>\n\n' +
    'Якщо у вас виникли запитання, чи вам потрібна індивідуальна послуга, якої немає в переліку, ' +
    'зв’яжіться з нашим адміністратором: @Humgat',

  HintEnterOrSkip: 'Будь ласка, введіть текст або натисніть кнопку "Пропустити".',
  SaveBurial: '⏳ Зберігаю дані про поховання у базі...',

  ReturnToMainMenu: 'Повертаємось до головного меню:',
  HintEnterText: 'Будь ласка, введіть текст.',
  NotFoundDescription: 'Опис для цієї послуги відсутній.',
  ErrorLoadDescription: 'Не вдалося завантажити опис.',
  ErrorTryLater: 'Сталася помилка. Спробуйте пізніше.',
  ErrorReturnToServices: 'Помилка при поверненні до списку послуг:',

  ErrorSaveOrder: 'Сталася помилка при збереженні поховання. Спробуйте заново.',
  ErrorPrepareOrder: 'Сталася помилка при формуванні заявки. Перевірте символи вводу або спробуйте пізніше',
} as const;

export const BurialMenu = {
  Geo: '📍 Геолокація Telegram',
  GoogleMap: '🔗 Посилання Google Maps',
  Text: '✍️ Текстовий опис у форматі Область / Населений пункт',
  // City: '🏛 Область / Населений пункт',
} as const;

export const Step = {
  Step1: '<b>Крок 1. Оберіть тип послуги:</b>',
  Step2: '<b>Крок 2. Анкета померлого:</b>',
  Step3: '<b>Крок 3. Як ви хочете вказати місце поховання?</b>',
  Step4: '<b>Крок 4. Додаткова інформація, на що варто звернути увагу</b> (можна залишити порожнім):',
  Step5: '<b>Крок 5. Поділіться контактом</b> для зв’язку з вами (або вкажіть іншу інформацію по якій можна з вами зв’язатись):',
} as const;

export const MainMenu = {
  CreateOrder: '✨ Створити замовлення',
  MyOrders: '🗂 Мої замовлення',
  MyBurialsMemorials: '🪦 Мої місця пам’яті',
  Help: 'ℹ️ Підтримка',
  Services: '📋 Послуги',
} as const;

export const mainMenuButtons = Markup.keyboard([
  [MainMenu.Services],
  [MainMenu.CreateOrder, MainMenu.MyBurialsMemorials],
  [MainMenu.MyOrders, MainMenu.Help],
]).resize().reply_markup;

export const editMenuButtons = [
  [Markup.button.callback('🏷️ Назва', 'edit_burial_displayName')],
  [Markup.button.callback('👤 Прізвище', 'edit_lastName'), Markup.button.callback('👤 Ім’я', 'edit_name')],
  [Markup.button.callback('👤 По батькові', 'edit_father')],
  [Markup.button.callback('📅 Дата народження', 'edit_birth'), Markup.button.callback('🕯 Дата смерті', 'edit_death')],
  [Markup.button.callback('📍 Локація/Дані місця', 'edit_location'), Markup.button.callback('👁 Орієнтир', 'edit_cemeteryDetails')],
  [Markup.button.callback('💬 Коментар', 'edit_comment'), Markup.button.callback('📱 Телефон', 'edit_phone')],
  [Markup.button.callback('↩️ Назад', 'edit_back_to_summary')]
];

export const editBurialMenuButtons = [
  [Markup.button.callback('🏷️ Назва', 'edit_burial_displayName')],
  [Markup.button.callback('👤 Прізвище', 'edit_lastName'), Markup.button.callback('👤 Ім’я', 'edit_name')],
  [Markup.button.callback('👤 По батькові', 'edit_father')],
  [Markup.button.callback('📅 Дата народження', 'edit_birth'), Markup.button.callback('🕯 Дата смерті', 'edit_death')],
  [Markup.button.callback('📍 Локація/Дані місця', 'edit_location'), Markup.button.callback('👁 Орієнтир', 'edit_cemeteryDetails')],
  [Markup.button.callback('💬 Коментар', 'edit_comment')],
  [Markup.button.callback('❌ Видалити місце', 'delete_burial')],
  [Markup.button.callback('↩️ Назад', 'edit_cancel')]
];

export async function showMainMenu(ctx: Context,) {
  await ctx.reply(OrderStepUa.MainMenu, {reply_markup: mainMenuButtons},);
}

export function fetchEditHint(callbackData: string): string {
  let promptText = '✍️ Введіть нове значення:';

  if (callbackData === 'edit_burial_displayName') promptText = '✍️ Введіть нову <b>Назву</b> для картки поховання (наприклад: <i>"Могила дідуся"</i>):';
  else if (callbackData === 'edit_lastName') promptText = '✍️ Введіть нове <b>Прізвище</b> померлого:';
  else if (callbackData === 'edit_name') promptText = '✍️ Введіть нове <b>Ім’я</b> померлого:';
  else if (callbackData === 'edit_father') promptText = '✍️ Введіть нове <b>По батькові</b> померлого:';
  else if (callbackData === 'edit_birth') promptText = '✍️ Введіть <b>Дату народження</b> (строкою):';
  else if (callbackData === 'edit_death') promptText = '✍️ Введіть <b>Дату смерті</b> (строкою):';
  else if (callbackData === 'edit_location') promptText = '✍️ Введіть нову <b>Локацію/Адресу місця</b> або надішліть посилання на карту:';
  else if (callbackData === 'edit_cemeteryDetails') promptText = '✍️ Введіть новий <b>Орієнтир місця</b> (наприклад: <i>"біля центральної алеї, сектор 4"</i>):';
  else if (callbackData === 'edit_comment') promptText = '✍️ Введіть новий <b>коментар</b> до замовлення:';
  else if (callbackData === 'edit_phone') promptText = '✍️ Введіть ваш новий <b>номер телефону</b>:';

  return promptText;
}

export const OrderStatusLabels: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.New]: 'Нова',
  [OrderStatus.AwaitingAdminReview]: 'Очікує перевірки адміном',
  [OrderStatus.Confirmed]: 'Підтверджено',
  [OrderStatus.AvailableForExecutor]: 'Доступно для виконавця',
  [OrderStatus.Assigned]: 'Призначено',
  [OrderStatus.AwaitingClientConfirmation]: 'Очікує підтвердження клієнта',
  [OrderStatus.InProgress]: 'В роботі',
  [OrderStatus.AwaitingCompletionReview]: 'Очікує перевірки виконання',
  [OrderStatus.RevisionRequired]: 'Потребує доробки',
  [OrderStatus.Done]: 'Виконано',
  [OrderStatus.Rejected]: 'Відхилено',
  [OrderStatus.Canceled]: 'Скасовано',
  [OrderStatus.OnHold]: 'На утриманні',
  [OrderStatus.PendingClarification]: 'Потребує уточнення',
};

export function getOrderStatusDescription(status: OrderStatus): string {
  return OrderStatusLabels[status] ?? 'Невідомий статус';
}

export function generateGoogleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function formatToShortPhoneNumber(phone: string): string {
  const cleanPhone = phone.replace(/\D/g, '');

  if (cleanPhone.startsWith('380') && cleanPhone.length === 12) {
    return cleanPhone.substring(2);
  }

  return cleanPhone;
}

export const ExecutorMenu = {
  OpenOrders: '📋 Відкриті замовлення',
  MyOrders: '💼 Мої замовлення',
  DoneOrders: '✅ Виконані',
  Help: '🆘 Допомога / Проблема',
} as const;

export const executorMainMenuButtons = Markup.keyboard([
  [ExecutorMenu.OpenOrders],
  [ExecutorMenu.MyOrders, ExecutorMenu.DoneOrders],
  [ExecutorMenu.Help],
]).resize().reply_markup;

export const ExecutorActions = {
  View: '👁 Переглянути',
  TakeOrder: '🛍 Взяти замовлення',
  StartWork: '▶️ Почати',
  RequestUpdate: '🔄 Запросити оновлення',
  RequestClarification: '❓ Запросити уточнення',
  ReportProblem: '📝 Повідомити про проблему',
  CannotComplete: '❌ Не можу виконати замовлення',
  SubmitWork: '📤 Надіслати роботу на перевірку',
  ConfirmCorrect: '✅ Підтверджую, що всі роботи виконані',
  NeedUpdate: '⚠️ Інформація потребує оновлення',
  AddService: '🛍 Додати послугу',
  BackToMenu: '↩️ Назад до меню',
} as const;

export const executorSceneEnterMessage = '👋 Ласкаво просимо до бота виконавця! Оберіть дію з меню нижче:';
