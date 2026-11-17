import { Markup } from 'telegraf';
import { OrderStatus } from '../../orders/models/order-status';
import { getOrderStatusDescription } from '../telegram-constants';
import { ExecutorConst } from './executor-const';

/** Статуси, які ще «в руках» виконавця — показуємо в «Мої замовлення» */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.Assigned,
  OrderStatus.InProgress,
  OrderStatus.RevisionRequired,
  OrderStatus.AwaitingCompletionReview,
  OrderStatus.PendingClarification,
  OrderStatus.OnHold,
];

/** Завершені замовлення — розділ «Виконані» */
export const DONE_ORDER_STATUSES: OrderStatus[] = [OrderStatus.Done];

/** Мінімальна інформація про місце пам'яті, потрібна для виконання */
export type BurialInfo = {
  cemetery?: string | null;
  coordinates?: string | null;
  notes?: string | null;
  burialLastName?: string | null;
  burialName?: string | null;
  burialFatherName?: string | null;
  photos?: string[];
};

/** Мапована сутність замовлення (див. OrdersService.mapOrderFields) */
export type ExecutorOrder = {
  id: string;
  status: OrderStatus;
  service: { id: string; name: string; price: number } | null;
  additionalServices?: string[];
  clientComment?: string;
  client: {
    name?: string;
    phone?: string;
    email?: string | null;
    telegramId?: string;
  };
  details?: { burialId?: string };
  report?: {
    adminComment?: string;
    photosBefore?: string[];
    photosAfter?: string[];
  };
  deadlines?: {
    serviceDateFrom?: Date | null;
    serviceDateTo?: Date | null;
    executionDeadline?: Date | null;
  };
  deadlineDisplay?: { executionDeadline?: string; remaining?: string };
  isOverdue?: boolean;
};

export type ContinueAction = {
  label: string;
  /** callback_data, який обробляє сцена */
  action: 'start' | 'continue' | 'revision' | 'none';
  /** повідомлення, яке показуємо замість кнопки продовження */
  hint?: string;
};

/**
 * Що робити із замовленням залежно від статусу.
 * Саме тут визначається «продовжити в залежності від статусу».
 */
export function resolveContinueAction(status: OrderStatus): ContinueAction {
  switch (status) {
    case OrderStatus.Assigned:
      return { label: ExecutorConst.MyOrdersStartButton, action: 'start' };
    case OrderStatus.InProgress:
      return { label: ExecutorConst.MyOrdersContinueButton, action: 'continue' };
    case OrderStatus.RevisionRequired:
      return { label: ExecutorConst.MyOrdersRevisionButton, action: 'revision' };
    case OrderStatus.AwaitingCompletionReview:
      return {
        label: ExecutorConst.MyOrdersContinueButton,
        action: 'none',
        hint: ExecutorConst.MyOrdersAwaitingReview,
      };
    case OrderStatus.PendingClarification:
      return {
        label: ExecutorConst.MyOrdersContinueButton,
        action: 'none',
        hint: ExecutorConst.MyOrdersPendingClarification,
      };
    case OrderStatus.OnHold:
      return {
        label: ExecutorConst.MyOrdersContinueButton,
        action: 'none',
        hint: ExecutorConst.MyOrdersOnHold,
      };
    default:
      return {
        label: ExecutorConst.MyOrdersContinueButton,
        action: 'none',
        hint: ExecutorConst.MyOrdersCannotContinue,
      };
  }
}

function formatDate(value?: Date | string | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('uk-UA');
}

/** Екранує HTML-спецсимволи, щоб динамічний контент не ламав розмітку Telegram */
function escapeHtml(value?: string | null): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

function formatAdditionalServices(services?: string[]): string {
  const list = (services ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0) return ExecutorConst.MyOrdersNoAdditionalServices;
  return list.map((s, i) => `\n  ${i + 1}. ${escapeHtml(s)}`).join('');
}

/**
 * Картка «Моє замовлення — деталі».
 * Виконавець бачить лише те, що потрібно для виконання роботи.
 */
export function formatOrderDetails(
  order: ExecutorOrder,
  burial?: BurialInfo,
): string {
  const lines: string[] = [];

  lines.push(ExecutorConst.MyOrdersDetailsTitle(order.id));
  if (order.isOverdue) {
    lines.push('🔴 <b>ПРОСТРОЧЕНО</b>');
  }

  lines.push('');
  lines.push(`📌 <b>Послуга:</b> ${escapeHtml(order.service?.name) || '—'}`);
  lines.push(
    `➕ <b>Додаткові послуги:</b>${formatAdditionalServices(order.additionalServices)}`,
  );
  lines.push(`📅 <b>Дата виконання:</b> ${formatDate(order.deadlines?.serviceDateFrom)}`);
  lines.push(
    `⏰ <b>Виконати до:</b> ${escapeHtml(order.deadlineDisplay?.executionDeadline) || '—'}` +
      (order.deadlineDisplay?.remaining
        ? ` (залишилось: ${escapeHtml(order.deadlineDisplay.remaining)})`
        : ''),
  );
  lines.push(`📊 <b>Статус:</b> ${getOrderStatusDescription(order.status)}`);
  lines.push(
    `💬 <b>Коментар клієнта:</b> ${
      order.clientComment?.trim()
        ? escapeHtml(order.clientComment.trim())
        : ExecutorConst.MyOrdersNoClientComment
    }`,
  );

  // Клієнт — тільки те, що потрібно для виконання
  lines.push('');
  lines.push('👤 <b>Клієнт:</b>');
  lines.push(`  • Ім'я: ${escapeHtml(order.client?.name) || '—'}`);
  lines.push(`  • Телефон: ${escapeHtml(order.client?.phone) || '—'}`);

  // Місце виконання — без нього виконавець не знайде могилу
  lines.push('');
  lines.push('📍 <b>Місце виконання:</b>');
  lines.push(`  • Кладовище: ${escapeHtml(burial?.cemetery) || '—'}`);
  lines.push(`  • Сектор / ряд / номер: ${escapeHtml(burial?.notes) || '—'}`);
  lines.push(`  • GPS: ${escapeHtml(burial?.coordinates) || '—'}`);
  const burialFullName = burial
    ? `${burial.burialLastName ?? ''} ${burial.burialName ?? ''} ${burial.burialFatherName ?? ''}`.trim()
    : '';
  lines.push(`  • ПІБ: ${escapeHtml(burialFullName) || '—'}`);

  return lines.join('\n');
}

/**
 * Кнопки списку замовлень.
 * `prefix` — спільна частина callback_data (напр. `executor_myorders_`),
 * далі додаються `open_<id>`, `refresh`, `menu`.
 */
export function buildOrderListKeyboard(
  orders: ExecutorOrder[],
  prefix: string,
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons = orders.map((order) => [
    Markup.button.callback(
      `№${order.id} · ${order.service?.name ?? '—'} · ${getOrderStatusDescription(order.status)}`,
      `${prefix}open_${order.id}`,
    ),
  ]);

  buttons.push([
    Markup.button.callback(ExecutorConst.MyOrdersRefreshButton, `${prefix}refresh`),
  ]);
  buttons.push([
    Markup.button.callback(ExecutorConst.BackToMenu, `${prefix}menu`),
  ]);

  return Markup.inlineKeyboard(buttons);
}

/** Результат пагінації */
export type Paginated<T> = {
  /** елементи поточної сторінки */
  items: T[];
  /** поточна сторінка (0-indexed, обмежена діапазоном) */
  page: number;
  /** загальна кількість сторінок (>= 1) */
  totalPages: number;
  /** загальна кількість елементів */
  total: number;
};

/** Розбиває список на сторінки. `page` — 0-indexed, буде обмежено діапазоном. */
export function paginate<T>(items: T[], page: number, pageSize: number): Paginated<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const start = clampedPage * pageSize;
  return {
    items: total === 0 ? [] : items.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
    total,
  };
}

/**
 * Кнопки списку замовлень з пагінацією.
 * callback_data: `${prefix}open_<id>`, `${prefix}prev`, `${prefix}next`,
 * `${prefix}noop` (індикатор сторінки), `${prefix}cancel`.
 */
export function buildPaginatedOrderKeyboard(
  pageItems: ExecutorOrder[],
  page: number,
  totalPages: number,
  prefix: string,
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons = pageItems.map((order) => [
    Markup.button.callback(
      `№${order.id} · ${order.service?.name ?? '—'}`,
      `${prefix}open_${order.id}`,
    ),
  ]);

  // Навігація по сторінках
  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 0) {
    nav.push(Markup.button.callback(ExecutorConst.DoneOrdersPrevButton, `${prefix}prev`));
  }
  nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, `${prefix}noop`));
  if (page < totalPages - 1) {
    nav.push(Markup.button.callback(ExecutorConst.DoneOrdersNextButton, `${prefix}next`));
  }
  if (nav.length > 0) {
    buttons.push(nav);
  }

  // Скасування перегляду списку
  buttons.push([
    Markup.button.callback(ExecutorConst.DoneOrdersCancelButton, `${prefix}cancel`),
  ]);

  return Markup.inlineKeyboard(buttons);
}