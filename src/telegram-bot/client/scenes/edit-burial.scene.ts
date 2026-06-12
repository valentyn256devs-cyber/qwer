import {Context as Ctx, Wizard, WizardStep} from 'nestjs-telegraf';
import {Markup} from 'telegraf';
import {BurialsService} from '../../../burials/burials.service';
import {type OrderWizardContext} from '../interfaces/order-wizard-context.interface';
import {OrderStepUa, Scene, showMainMenu} from '../../telegram-constants';

@Wizard(Scene.EDIT_BURIAL_WIZARD)
export class EditBurialScene {
  constructor(private readonly burialsService: BurialsService) {
  }

  /**
   * КРОК 1: Завантаження об'єкта та вибір поля для редагування
   */
  @WizardStep(1)
  async stepInitEdit(@Ctx() ctx: OrderWizardContext) {
    const burialId = ctx.session.orderForm?.burialId;

    if (!burialId) {
      await ctx.reply('❌ Помилка: об\'єкт для редагування не знайдено.');
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }

    await ctx.reply(OrderStepUa.Loading ?? '⏳ Завантаження даних...');

    try {
      const b = await this.burialsService.findBurialById(burialId);
      if (!b) {
        await ctx.reply('❌ Об\'єкт не знайдено в базі даних.');
        await showMainMenu(ctx);
        return ctx.scene.leave();
      }

      const fioParts = [b.burialLastName, b.burialName, b.burialFatherName].filter(Boolean);
      const fullName = fioParts.length > 0 ? fioParts.join(' ') : 'Не вказано';

      const infoText =
        `🛠 <b>Редагування місця пам'яті</b>\n\n` +
        `🏷 <b>Назва картки:</b> ${b.name}\n` +
        `📝 <b>ПІБ померлого:</b> ${fullName}\n` +
        `📍 <b>Цвинтар:</b> ${b.cemetery || 'Не вказано'}\n` +
        `🌐 <b>Координати:</b> <code>${b.coordinates || 'Не вказано'}</code>\n\n` +
        `Оберіть, який параметр ви бажаєте змінити:`;

      const buttons = [
        [Markup.button.callback('🏷 Змінити назву картки', 'edit_field_name')],
        [Markup.button.callback('📝 Змінити ПІБ померлого', 'edit_field_fio')],
        [Markup.button.callback('📍 Змінити Цвинтар/Адресу', 'edit_field_cemetery')],
        [Markup.button.callback('🌐 Змінити Координати', 'edit_field_coords')],
        [Markup.button.callback('❌ Скасувати', 'edit_cancel')],
      ];

      await ctx.reply(infoText, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });

      ctx.wizard.next();
    } catch (error) {
      console.error(error);
      await ctx.reply('❌ Помилка при завантаженні даних місця.');
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }
  }

  /**
   * КРОК 2: Обробка вибору користувача та запит на введення нового тексту
   */
  @WizardStep(2)
  async stepHandleFieldChoice(@Ctx() ctx: OrderWizardContext) {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery || !('data' in callbackQuery)) return;

    const callbackData = callbackQuery.data;
    await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);

    if (callbackData === 'edit_cancel') {
      await ctx.deleteMessage().catch(() => null);
      await ctx.reply('🚫 Редагування скасовано.');
      // Тут можна викликати повернення в головне меню або минулий список:
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // Тимчасово записуємо в сесію, яке саме поле юзер хоче відредагувати
    ctx.session.orderForm.editTargetField = callbackData;

    await ctx.deleteMessage().catch(() => null);

    let promptText = '';
    if (callbackData === 'edit_field_name') {
      promptText = '✍️ Введіть <b>нову внутрішню назву</b> для цієї картки (наприклад: <i>"Могила дідуся"</i>):';
    } else if (callbackData === 'edit_field_fio') {
      promptText = '✍️ Введіть нове <b>ПІБ померлого</b> через пробіл (наприклад: <i>"Іванов Петро Сидорович"</i>):';
    } else if (callbackData === 'edit_field_cemetery') {
      promptText = '✍️ Введіть нову <b>назву цвинтаря або адресу</b>:';
    } else if (callbackData === 'edit_field_coords') {
      promptText = '✍️ Надішліть нові <b>координати</b> текстом (наприклад: <code>50.4501,30.5234</code>):';
    }

    await ctx.reply(promptText, {parse_mode: 'HTML'});
    ctx.wizard.next();
  }

  /**
   * КРОК 3: Прийом нового значення та збереження його в базу даних
   */
  @WizardStep(3)
  async stepSaveNewValue(@Ctx() ctx: OrderWizardContext) {
    const msg = ctx.message;
    if (!msg || !('text' in msg)) {
      await ctx.reply('⚠️ Будь ласка, надішліть коректний текст.');
      return;
    }

    const newValue = msg.text.trim();
    const targetField = ctx.session.orderForm?.editTargetField;
    const burialId = ctx.session.orderForm?.burialId;

    if (!burialId || !targetField) {
      await ctx.reply('❌ Сталася помилка сесії. Спробуйте знову.');
      await showMainMenu(ctx);
      return ctx.scene.leave();
    }

    await ctx.reply('⏳ Зберігаю зміни...');

    try {
      const updateData: any = {};

      if (targetField === 'edit_field_name') {
        updateData.name = newValue;
      } else if (targetField === 'edit_field_cemetery') {
        updateData.cemetery = newValue;
      } else if (targetField === 'edit_field_coords') {
        updateData.coordinates = newValue;
      } else if (targetField === 'edit_field_fio') {
        // Парсимо ПІБ назад на окремі складові для вашої бази
        const parts = newValue.split(/\s+/);
        updateData.burialLastName = parts[0] || '';
        updateData.burialName = parts[1] || '';
        updateData.burialFatherName = parts[2] || '';
      }

      await this.burialsService.updateBurial(burialId, updateData);
      await ctx.reply('✅ Дані успішно оновлено!');

      if (!ctx.session.orderForm) {
        ctx.session.orderForm = {};
      }

      // Очищуємо тимчасові змінні редагування з сесії
      delete ctx.session.orderForm.editTargetField;
    } catch (error) {
      console.error(error);
      await ctx.reply('❌ Не вдалося зберегти зміни.');
    }

    await showMainMenu(ctx);
    return ctx.scene.leave();
  }
}