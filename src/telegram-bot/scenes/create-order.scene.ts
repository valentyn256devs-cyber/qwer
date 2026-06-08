import { Wizard, WizardStep, Context as Ctx } from 'nestjs-telegraf';
import { Markup } from 'telegraf';
import { ServicesService } from '../../services/services.service';
import { OrdersService } from '../../orders/orders.service';
import { type OrderWizardContext } from '../interfaces/order-wizard-context.interface';

@Wizard('CREATE_ORDER_WIZARD')
export class CreateOrderScene {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly servicesService: ServicesService,
  ) {}

  /**
   * КРОК 1: Вибір типу послуги
   */
  @WizardStep(1)
  async step1(@Ctx() ctx: OrderWizardContext) {
    await ctx.reply('🔄 Завантажую доступні послуги...');
    try {
      const services = await this.servicesService.findAll();
      if (services.length === 0) {
        await ctx.reply('Наразі немає доступних послуг. Спробуйте пізніше.');
        await ctx.scene.leave();
        return;
      }

      // Створюємо інлайн-кнопки з послугами з бази Back4app
      const buttons = services.map((s) => [
        Markup.button.callback(`${s.name} (${s.price} грн)`, `service_${s.id}`),
      ]);

      await ctx.reply('<b>Крок 1. Оберіть тип послуги:</b>', {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });

      ctx.wizard.next();
    } catch (error) {
      console.log(error);
      await ctx.reply('Помилка завантаження послуг.');
      return ctx.scene.leave();
    }
  }

  /**
   * КРОК 2: Обробка вибору послуги та вибір варіанту локації
   */
  @WizardStep(2)
  async step2(@Ctx() ctx: OrderWizardContext) {
    // 1. Отримуємо об'єкт callbackQuery
    const callbackQuery = ctx.callbackQuery;

    // 2. Перевіряємо за допомогою оператора 'in', чи є в ньому дані (data)
    if (callbackQuery && 'data' in callbackQuery) {
      const callbackData = callbackQuery.data;

      if (callbackData.startsWith('service_')) {
        const [, serviceId] = callbackData.split('_');

        try {
          const service = await this.servicesService.findOne(serviceId);

          ctx.wizard.state.serviceId = serviceId;
          ctx.wizard.state.serviceName = service.name;
        } catch (e) {
          console.log(e);
          ctx.wizard.state.serviceId = serviceId;
          ctx.wizard.state.serviceName = 'Послуга';
        }
        // 🔥 КАНТОВИЙ ФІКС: Викликаємо метод безпосередньо через Telegram API клієнт.
        // Згідно з надісланим d.ts, ctx.telegram завжди доступний і містить нативний метод.
        // Передаємо ID запиту, щоб зняти "зависання" (годинничок) з інлайн-кнопки.
        await ctx.telegram.answerCbQuery(callbackQuery.id);
      }
    }

    // 3. Якщо користувач чомусь не обрав послугу, а просто надіслав текст
    if (!ctx.wizard.state.serviceId) {
      await ctx.reply(
        'Будь ласка, оберіть послугу зі списку вище, натиснувши на кнопку.',
      );
      return; // Залишаємо користувача на цьому ж кроці
    }

    // 4. Виводимо клавіатуру вибору локації за ТЗ
    await ctx.reply('<b>Крок 2. Як ви хочете вказати місце поховання?</b>', {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        ['📍 Геолокація Telegram', '🔗 Посилання Google Maps'],
        ['✍️ Текстовий опис', '🏛 Область / Населений пункт'],
      ])
        .oneTime()
        .resize().reply_markup,
    });

    // Переходимо до наступного кроку візарда
    ctx.wizard.next();
  }

  /**
   * КРОК 3: Очікування вибору варіанту і підказка як ввести дані
   */
  @WizardStep(3)
  async step3(@Ctx() ctx: OrderWizardContext) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const text = ctx.message?.text as string | undefined;

    if (text === '📍 Геолокація Telegram') {
      ctx.wizard.state.locationType = 'coordinates';
      await ctx.reply(
        'Надішліть, будь ласка, локацію (кнопка Скріпка -> Локація):',
        Markup.keyboard([
          [Markup.button.locationRequest('Надіслати мою поточну геолокацію')],
        ]).resize(),
      );
    } else if (text === '🔗 Посилання Google Maps') {
      ctx.wizard.state.locationType = 'google_maps';
      await ctx.reply(
        'Надішліть посилання на Google Maps:',
        Markup.removeKeyboard(),
      );
    } else {
      ctx.wizard.state.locationType = 'address_text';
      await ctx.reply(
        'Введіть повний опис місця (Область, Цвинтар, Сектор/Ряд/Номер):',
        Markup.removeKeyboard(),
      );
    }
    ctx.wizard.next();
  }

  /**
   * КРОК 4: Запис локації та перехід до Опису завдання / Коментаря
   */
  @WizardStep(4)
  async step4(@Ctx() ctx: OrderWizardContext) {
    const msg = ctx.message;

    // 1. Перевіряємо, чи взагалі існує об'єкт повідомлення
    if (!msg) {
      await ctx.reply('Будь ласка, надішліть коректні дані локації.');
      return; // Залишаємо користувача на цьому ж кроці
    }

    // 2. Безпечно перевіряємо наявність геолокації (Варіант 2 з ТЗ)
    if (ctx.wizard.state.locationType === 'coordinates' && 'location' in msg) {
      ctx.wizard.state.locationData = `${msg.location.latitude},${msg.location.longitude}`;
    }
    // 3. Безпечно перевіряємо наявність тексту (Варіанти 1, 3, 4 з ТЗ)
    else if ('text' in msg && msg.text) {
      ctx.wizard.state.locationData = msg.text;
    }
    // 4. Якщо прийшов не той тип даних (наприклад, користувач замість локації скинув стікер)
    else {
      await ctx.reply(
        'Некоректний формат. Будь ласка, надішліть локацію або текст.',
      );
      return;
    }

    // 5. Переходимо до наступного кроку за ТЗ
    await ctx.reply(
      '<b>Крок 4. Додайте опис завдання</b> (напишіть текст коментаря або побажань):',
      {
        parse_mode: 'HTML',
      },
    );

    ctx.wizard.next();
  }

  /**
   * КРОК 5: Контактні дані (Ім'я, телефон)
   */
  @WizardStep(5)
  async step5(@Ctx() ctx: OrderWizardContext) {
    if (ctx.message && 'text' in ctx.message) {
      ctx.wizard.state.customComment = ctx.message.text;
    }

    // За замовчуванням беремо ім'я з телеграму
    ctx.wizard.state.clientName = ctx.from?.first_name ?? 'Клієнт';

    await ctx.reply('<b>Крок 5. Поділіться контактом</b> для зв’язку з вами:', {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([
        [Markup.button.contactRequest('📱 Поділитися номером телефону')],
      ]).resize().reply_markup,
    });
    ctx.wizard.next();
  }

  /**
   * КРОК 6: Підтвердження заявки
   */
  @WizardStep(6)
  async step6(@Ctx() ctx: OrderWizardContext) {
    const msg = ctx.message;

    // 1. Перевіряємо, чи взагалі існує об'єкт повідомлення
    if (!msg) {
      await ctx.reply(
        'Будь ласка, натисніть кнопку або введіть номер телефону вручну.',
      );
      return;
    }

    // 2. Безпечно перевіряємо, чи це повідомлення з контактом (кнопка "Поділитися номером")
    if ('contact' in msg) {
      ctx.wizard.state.clientPhone = msg.contact.phone_number;
    }
    // 3. Безпечно перевіряємо, чи користувач ввів телефон текстом вручну
    else if ('text' in msg && msg.text) {
      ctx.wizard.state.clientPhone = msg.text;
    }
    // 4. Якщо прийшов невідповідний тип повідомлення
    else {
      await ctx.reply(
        'Будь ласка, натисніть кнопку або введіть номер телефону вручну.',
      );
      return;
    }

    const state = ctx.wizard.state;

    // Виводимо резюме замовлення перед фінальним збереженням за ТЗ
    const summary =
      `📝 <b>ПЕРЕВІРКА ЗАЯВКИ</b>\n\n` +
      `📦 <b>Послуга:</b> ${state.serviceName ?? ''}\n` +
      `📍 <b>Тип локації:</b> ${state.locationType ?? ''}\n` +
      `📍 <b>Дані місця:</b> ${state.locationData ?? ''}\n` +
      `💬 <b>Коментар:</b> ${state.customComment ?? 'Немає'}\n` +
      `👤 <b>Клієнт:</b> ${state.clientName ?? ''}\n` +
      `📱 <b>Телефон:</b> ${state.clientPhone ?? ''}\n\n` +
      `Все правильно?`;

    await ctx.reply(summary, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Підтверджую і Створюю',
            'confirm_order_save',
          ),
        ],
        [Markup.button.callback('❌ Скасувати', 'cancel_order_wizard')],
      ]).reply_markup,
    });

    ctx.wizard.next();
  }

  /**
   * ФІНАЛ: Збереження в Back4app
   */
  @WizardStep(7)
  async step7(@Ctx() ctx: OrderWizardContext) {
    // 1. Використовуємо Type Guard, щоб TypeScript знав, що це клік по інлайн-кнопці
    if (ctx.has('callback_query') && 'data' in ctx.callbackQuery) {
      const callbackData = ctx.callbackQuery.data;

      // 🔥 ФІКС 1: Викликаємо суворо типізований answerCbQuery через ctx.telegram
      await ctx.telegram.answerCbQuery(ctx.callbackQuery.id);

      if (callbackData === 'confirm_order_save') {
        await ctx.reply('⏳ Зберігаю вашу заявку у хмарі...');

        const state = ctx.wizard.state;
        const telegramId = ctx.from.id.toString();

        try {
          const newOrder = await this.ordersService.create({
            clientName: state.clientName ?? 'Клієнт',
            clientPhone: state.clientPhone ?? '',
            telegramId: telegramId,
            serviceId: state.serviceId ?? '',
            customComment: state.customComment,
            locationType: state.locationType ?? 'address_text',
            locationData: state.locationData ?? '',
          });

          await ctx.reply(
            `🎉 <b>Заявку №${newOrder.id} успішно створено!</b>\n\n` +
              `Адміністратор вже взяв її на перевірку. Ви отримаєте сповіщення про зміну статусу тут.`,
            {
              parse_mode: 'HTML',
              reply_markup: Markup.removeKeyboard().reply_markup,
            },
          );
        } catch (error) {
          console.log(error);
          await ctx.reply(
            'Помилка сервера під час створення заявки. Спробуйте пізніше.',
          );
        }
      } else {
        await ctx.reply(
          'Скасовано. Ви можете розпочати заново за допомогою головного меню.',
          Markup.removeKeyboard(),
        );
      }
    } else {
      // Якщо користувач замість кліку по кнопці просто надіслав текст на етапі підтвердження
      await ctx.reply('Будь ласка, оберіть дію на інлайн-кнопках вище.');
      return;
    }

    return ctx.scene.leave();
  }
}
