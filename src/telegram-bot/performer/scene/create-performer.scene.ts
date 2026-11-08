/*
import {Ctx, Wizard} from 'nestjs-telegraf';
import {type PerformerWizardContext} from '../../client/interfaces/performer-wizard.context.interface';
import {Scene} from '../../telegram-constants';
import {PerformerStatus} from "../../../performers/model/performer.status";

@Wizard(Scene.CREATE_PERFORMER_WIZARD)
export class CreatePerformerScene {
  /!**
   * Entry point – ask for last name
   *!/
  async enter(@Ctx() ctx: PerformerWizardContext) {
    ctx.session.performer = {};
    ctx.session.performerStep = 'lastName';
    await ctx.reply('👤 Введіть прізвище виконавця:');
  }

  /!**
   * Handle text input for each step
   *!/
  async onText(@Ctx() ctx: PerformerWizardContext) {
    const step = ctx.session.performerStep;
    const text = ctx.message?.text ?? '';
    if (!step) return;
    switch (step) {
      case 'lastName':
        ctx.session.performer!.lastName = text;
        ctx.session.performerStep = 'firstName';
        await ctx.reply('🧑‍💼 Введіть ім’я виконавця:');
        break;
      case 'firstName':
        ctx.session.performer!.firstName = text;
        ctx.session.performerStep = 'patronymic';
        await ctx.reply('🧑‍💼 Введіть по батькові виконавця (можна пропустити):');
        break;
      case 'patronymic':
        ctx.session.performer!.patronymic = text;
        ctx.session.performerStep = 'city';
        await ctx.reply('🏙 Введіть місто:');
        break;
      case 'city':
        ctx.session.performer!.city = text;
        ctx.session.performerStep = 'location';
        await ctx.reply('📍 Надішліть вашу геолокацію (кнопка «📍»):');
        break;
      case 'location':
        if (ctx.message?.location) {
          ctx.session.performer!.latitude = ctx.message.location.latitude;
          ctx.session.performer!.longitude = ctx.message.location.longitude;
          ctx.session.performerStep = 'radius';
          await ctx.reply('📏 Вкажіть радіус у кілометрах, який охоплює виконавець:');
        } else {
          await ctx.reply('❌ Не отримано геолокацію, спробуйте ще раз.');
        }
        break;
      case 'radius':
        const radius = parseInt(text, 10);
        if (!isNaN(radius)) {
          ctx.session.performer!.radiusKm = radius;
          ctx.session.performer!.status = PerformerStatus.PENDING;
          // Persist performer – placeholder
          console.log('New performer:', ctx.session.performer);
          await ctx.reply('✅ Виконавець створено!');
          await ctx.scene.leave();
        } else {
          await ctx.reply('❌ Невірний формат. Введіть число:');
        }
        break;
      default:
        await ctx.reply('❌ Невідомий крок.');
    }
  }
}

*/
