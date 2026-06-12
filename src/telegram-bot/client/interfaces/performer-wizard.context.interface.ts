import {Context} from "telegraf";
import {WizardContext} from "telegraf/scenes";

export type PerformerWizardContext = Context & WizardContext & {
  session: {
    performerStep?: string;
    performer?: {
      lastName?: string;
      firstName?: string;
      patronymic?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
      radiusKm?: number;
      status?: string;
    };
  };
};
