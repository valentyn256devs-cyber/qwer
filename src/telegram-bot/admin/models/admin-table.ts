export const AdminTable = {
  TableName: 'Admin',
  Fields: {
    TelegramId: 'telegramId',
    Username: 'username',
    FirstName: 'firstName',
    LastName: 'lastName',
    Role: 'role',
    IsActive: 'isActive',
    CreatedAt: 'createdAt',
    UpdatedAt: 'updatedAt',
  },
} as const;

export type AdminRole = 'admin' | 'super_admin';

export interface AdminEntity {
  objectId?: string;
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: AdminRole;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
