import { Context } from 'telegraf';
import {
  WizardContext,
  WizardSessionData,
} from 'telegraf/scenes';

export interface OrderWizardSession extends WizardSessionData {
  // 🔥 ДОДАЄМО СЮДИ: Тимчасовий об'єкт для збору даних у CREATE_BURIAL_WIZARD
  burialTemp?: {
    name?: string;
    burialName?: string;
    burialLastName?: string;
    burialFatherName?: string;
    birthDate?: string;
    deathDate?: string;
    cemetery?: string;
  };
}

export interface OrderForm {
  serviceId?: string;
  serviceName?: string;
  burialId?: string;
  burialDisplayName?: string;
  locationType?: 'coordinates' | 'address_text' | 'google_maps';
  locationData?: string;
  cemeteryDetails?: string;
  clientPhotos?: string[];
  customComment?: string;
  clientName?: string;
  clientPhone?: string;
  clientNickName?: string;
  clientEmail?: string;
}

export type OrderWizardContext = Context &
  WizardContext & {
    wizard: WizardContext['wizard'] & {
      state: OrderWizardSession;
    };
  } & {
  session: {
    __scenes?: any;
    pendingBurial?: {
      id: string;
      displayName: string;
    };
    orderForm?: OrderForm;
  };
};
