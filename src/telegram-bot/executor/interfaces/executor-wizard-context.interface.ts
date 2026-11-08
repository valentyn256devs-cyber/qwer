import { Context } from 'telegraf';
import {
  WizardContext,
  WizardSessionData,
} from 'telegraf/scenes';

export interface ExecutorWizardSession extends WizardSessionData {
  orderId?: string;
  stepIndex?: number;
}

export type ExecutorWizardContext = Context &
  WizardContext & {
    wizard: WizardContext['wizard'] & {
      state: ExecutorWizardSession;
    };
  } & {
    session: {
      orderId?: string;
      [key: string]: any;
    };
  };