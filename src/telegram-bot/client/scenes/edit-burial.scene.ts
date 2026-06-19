import {Context as Ctx, Wizard, WizardStep} from 'nestjs-telegraf';
import {Markup} from 'telegraf';
import {BurialsService} from '../../../burials/burials.service';
import {type OrderWizardContext} from '../interfaces/order-wizard-context.interface';
import {editBurialMenuButtons, fetchEditHint, OrderStepUa, Scene, showMainMenu} from '../../telegram-constants';

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

      /*const buttons = [
        [Markup.button.callback('🏷 Змінити назву картки', 'edit_field_name')],
        [Markup.button.callback('📝 Змінити ПІБ померлого', 'edit_field_fio')],
        [Markup.button.callback('📍 Змінити Цвинтар/Адресу', 'edit_field_cemetery')],
        [Markup.button.callback('🌐 Змінити Координати', 'edit_field_coords')],
        [Markup.button.callback('↩️ Скасувати редагування', 'edit_cancel')],
        [Markup.button.callback('❌ Видалити місце', 'delete_burial')],
      ];*/
      /*[
      [Markup.button.callback('🏷️ Назва', 'edit_burial_displayName')],
      [Markup.button.callback('👤 Прізвище', 'edit_lastName'), Markup.button.callback('👤 Ім\'я', 'edit_name')],
      [Markup.button.callback('👤 По батькові', 'edit_father')],
      [Markup.button.callback('📅 Дата народження', 'edit_birth'), Markup.button.callback('🕯 Дата смерті', 'edit_death')],
      [Markup.button.callback('📍 Локація/Дані місця', 'edit_location'), Markup.button.callback('👁 Орієнтир', 'edit_cemeteryDetails')],
      [Markup.button.callback('💬 Коментар', 'edit_comment'), Markup.button.callback('📱 Телефон', 'edit_phone')],
      [Markup.button.callback('↩️ Назад', 'edit_back_to_summary')],
      [Markup.button.callback('❌ Видалити місце', 'delete_burial')],
    ];*/

      await ctx.reply(infoText, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(editBurialMenuButtons).reply_markup,
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

    if (callbackData === 'delete_burial') {
      await ctx.deleteMessage().catch(() => null);

      await ctx.reply('⚠️ <b>Ви впевнені, що бажаєте видалити це місце пам\'яті?</b>\n\nЦю дію можна буде скасувати лише через адміністратора.', {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🗑 Так, видалити', 'confirm_delete_burial')],
          [Markup.button.callback('↩️ Ні, повернутися', 'cancel_delete_burial')]
        ]).reply_markup
      });

      // Переводимо візард на Крок 3, де чекаємо саме на клік підтвердження видалення
      ctx.wizard.selectStep(3); // Крок 4 (індекс 3)
      return;
    }

    if (!ctx.session.orderForm) {
      ctx.session.orderForm = {};
    }

    // Тимчасово записуємо в сесію, яке саме поле юзер хоче відредагувати
    ctx.session.orderForm.editTargetField = callbackData;
    await ctx.deleteMessage().catch(() => null);
    let promptText = fetchEditHint(callbackData)

    await ctx.reply(promptText, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(OrderStepUa.GoBack, 'edit_cancel')],
      ]).reply_markup
    });
    ctx.wizard.next();
  }

  /**
   * КРОК 3: Прийом нового значення та збереження його в базу даних
   */
  @WizardStep(3)
  async stepSaveNewValue(@Ctx() ctx: OrderWizardContext) {
    if (ctx.has('callback_query') && 'data' in ctx.callbackQuery) {
      const callbackData = ctx.callbackQuery.data;
      if (callbackData === 'edit_cancel') {
        ctx.wizard.selectStep(1);
        return this.stepHandleFieldChoice.call(this, ctx).catch(() => null);
      }
    }

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

      if (targetField === 'edit_burial_displayName') updateData.name = newValue;
      else if (targetField === 'edit_lastName') updateData.burialLastName = newValue;
      else if (targetField === 'edit_name') updateData.burialName = newValue;
      else if (targetField === 'edit_father') updateData.burialFatherName = newValue;
      else if (targetField === 'edit_birth') updateData.birthDate = newValue;
      else if (targetField === 'edit_death') updateData.deathDate = newValue;
      else if (targetField === 'edit_location') updateData.coordinates = newValue;
      else if (targetField === 'edit_cemeteryDetails') updateData.cemetery = newValue;
      else if (targetField === 'edit_comment') updateData.notes = newValue;

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

  @WizardStep(4)
  async stepHandleDeleteConfirmation(@Ctx() ctx: OrderWizardContext) {
    const callbackQuery = ctx.callbackQuery;

    // Якщо користувач замість кліку по кнопці підтвердження надіслав текст
    if (!callbackQuery || !('data' in callbackQuery)) {
      await ctx.reply('Будь ласка, оберіть дію на кнопках вище 👆');
      return;
    }

    const callbackData = callbackQuery.data;
    await ctx.telegram.answerCbQuery(callbackQuery.id).catch(() => null);
    await ctx.deleteMessage().catch(() => null);

    const burialId = ctx.session.orderForm?.burialId;

    // 1. Користувач передумав видаляти — повертаємо на початок редагування
    if (callbackData === 'cancel_delete_burial') {
      ctx.wizard.selectStep(0); // Повертаємо на stepInitEdit (Індекс 0)
      return this.stepInitEdit(ctx);
    }

    // 2. Користувач підтвердив Софт Деліт
    if (callbackData === 'confirm_delete_burial') {
      if (!burialId) {
        await ctx.reply('❌ Помилка: ID об\'єкта не знайдено.');
        await showMainMenu(ctx);
        return ctx.scene.leave();
      }

      try {
        await ctx.reply('⏳ Видалення місця пам\'яті...');

        // Викликаємо твій сервіс оновлення, передаючи маркер видалення
        await this.burialsService.updateBurial(burialId, {
          isDeleted: true // 🌟 Soft delete маркер для Back4app
        });

        await ctx.reply('🗑 Місце пам\'яті успішно видалено.');

        // Очищуємо форму
        delete ctx.session.orderForm;

        await showMainMenu(ctx);
        return ctx.scene.leave();
      } catch (error) {
        console.error('Помилка софт-деліту:', error);
        await ctx.reply('❌ Не вдалося видалити місце. Спробуйте пізніше.');
        await showMainMenu(ctx);
        return ctx.scene.leave();
      }
    }
  }
}