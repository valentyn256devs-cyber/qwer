import { Context } from 'telegraf';
import {
  WizardContext,
  WizardSessionData,
} from 'telegraf/scenes';

export interface OrderWizardSession extends WizardSessionData {
  // Тут ми накопичуємо дані під час кроків
  serviceId?: string;
  serviceName?: string;
  locationType?: 'coordinates' | 'address_text' | 'google_maps';
  locationData?: string;
  cemeteryDetails?: string;
  clientPhotos?: string[]; // масив base64 або file_id
  customComment?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
}

export type OrderWizardContext = Context &
  WizardContext & {
    wizard: WizardContext['wizard'] & {
      state: OrderWizardSession;
    };
  };
