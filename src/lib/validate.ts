// ============================================================
// VALIDACIÓN DE VALORES ENUM — evita errores "Data truncated"
// ============================================================
// Estas constantes reflejan los ENUMs definidos en mysql/schema.sql.
// Mantener sincronizado con el schema de la BD.

export const VALID = {
  // users.role
  USER_ROLES: ['owner', 'admin', 'seller', 'warehouse'] as const,
  // sales.status
  SALE_STATUSES: ['completed', 'partial', 'pending', 'cancelled'] as const,
  // payments.method
  PAYMENT_METHODS: ['cash', 'transfer', 'mixed', 'credit'] as const,
  // customer_payments.method
  CUSTOMER_PAYMENT_METHODS: ['cash', 'transfer', 'mixed'] as const,
  // stock_movements.type
  STOCK_MOVEMENT_TYPES: ['in', 'out', 'adjust', 'expense'] as const,
  // expenses.payment_method
  EXPENSE_PAYMENT_METHODS: ['cash', 'transfer', 'mixed'] as const,
  // cash_register.type
  CASH_REGISTER_TYPES: ['initial', 'adjustment'] as const,
  // locations.type
  LOCATION_TYPES: ['warehouse', 'store'] as const,
  // location_movements.type
  LOCATION_MOVEMENT_TYPES: ['entrada', 'salida', 'traslado_out', 'traslado_in', 'venta', 'ajuste'] as const,
} as const;

type ExtractType<T extends readonly string[]> = T[number];

export type UserRole = ExtractType<typeof VALID.USER_ROLES>;
export type SaleStatus = ExtractType<typeof VALID.SALE_STATUSES>;
export type PaymentMethod = ExtractType<typeof VALID.PAYMENT_METHODS>;
export type CustomerPaymentMethod = ExtractType<typeof VALID.CUSTOMER_PAYMENT_METHODS>;
export type StockMovementType = ExtractType<typeof VALID.STOCK_MOVEMENT_TYPES>;
export type LocationType = ExtractType<typeof VALID.LOCATION_TYPES>;
export type LocationMovementType = ExtractType<typeof VALID.LOCATION_MOVEMENT_TYPES>;
export type ExpensePaymentMethod = ExtractType<typeof VALID.EXPENSE_PAYMENT_METHODS>;
export type CashRegisterType = ExtractType<typeof VALID.CASH_REGISTER_TYPES>;

/**
 * Valida que `value` esté dentro del conjunto de valores permitidos.
 * Si es inválido, lanza un error 400 con un mensaje descriptivo.
 *
 * @param value        El valor a validar (string | undefined)
 * @param validValues  Array de strings válidos
 * @param label        Nombre descriptivo del campo (para el mensaje de error)
 * @returns            El valor tipado si es válido
 */
export function validateEnum<T extends readonly string[]>(
  value: string | undefined | null,
  validValues: T,
  label: string,
): T[number] {
  if (!value) {
    throw new EnumValidationError(`${label} es requerido`);
  }
  if (!validValues.includes(value as T[number])) {
    throw new EnumValidationError(
      `${label} inválido: "${value}". Valores permitidos: ${validValues.join(', ')}`,
    );
  }
  return value as T[number];
}

/**
 * Versión con valor por defecto — si el valor es undefined/null, usa el default.
 */
export function validateEnumOrDefault<T extends readonly string[]>(
  value: string | undefined | null,
  validValues: T,
  label: string,
  defaultValue: T[number],
): T[number] {
  const v = value ?? defaultValue;
  return validateEnum(v, validValues, label);
}

// --- Validadores específicos para cada ENUM ---

export function validateUserRole(role: string | undefined | null): UserRole {
  return validateEnum(role, VALID.USER_ROLES, 'Rol de usuario');
}

export function validateUserRoleOrDefault(
  role: string | undefined | null,
  defaultRole: UserRole = 'seller',
): UserRole {
  return validateEnumOrDefault(role, VALID.USER_ROLES, 'Rol de usuario', defaultRole);
}

export function validateStockMovementType(type: string | undefined | null): StockMovementType {
  return validateEnum(type, VALID.STOCK_MOVEMENT_TYPES, 'Tipo de movimiento de stock');
}

export function validateLocationType(type: string | undefined | null): LocationType {
  return validateEnum(type, VALID.LOCATION_TYPES, 'Tipo de ubicación');
}

export function validateLocationTypeOrDefault(
  type: string | undefined | null,
  defaultType: LocationType = 'warehouse',
): LocationType {
  return validateEnumOrDefault(type, VALID.LOCATION_TYPES, 'Tipo de ubicación', defaultType);
}

export function validatePaymentMethod(method: string | undefined | null): PaymentMethod {
  return validateEnum(method, VALID.PAYMENT_METHODS, 'Método de pago');
}

export function validatePaymentMethodOrDefault(
  method: string | undefined | null,
  defaultMethod: PaymentMethod = 'cash',
): PaymentMethod {
  return validateEnumOrDefault(method, VALID.PAYMENT_METHODS, 'Método de pago', defaultMethod);
}

export function validateCustomerPaymentMethod(method: string | undefined | null): CustomerPaymentMethod {
  return validateEnum(method, VALID.CUSTOMER_PAYMENT_METHODS, 'Método de pago');
}

export function validateCustomerPaymentMethodOrDefault(
  method: string | undefined | null,
  defaultMethod: CustomerPaymentMethod = 'cash',
): CustomerPaymentMethod {
  return validateEnumOrDefault(method, VALID.CUSTOMER_PAYMENT_METHODS, 'Método de pago', defaultMethod);
}

export function validateExpensePaymentMethod(method: string | undefined | null): ExpensePaymentMethod {
  return validateEnum(method, VALID.EXPENSE_PAYMENT_METHODS, 'Método de pago del gasto');
}

export function validateExpensePaymentMethodOrDefault(
  method: string | undefined | null,
  defaultMethod: ExpensePaymentMethod = 'cash',
): ExpensePaymentMethod {
  return validateEnumOrDefault(method, VALID.EXPENSE_PAYMENT_METHODS, 'Método de pago del gasto', defaultMethod);
}

export function validateLocationMovementType(type: string | undefined | null): LocationMovementType {
  return validateEnum(type, VALID.LOCATION_MOVEMENT_TYPES, 'Tipo de movimiento de almacén');
}

// --- Error personalizado ---

export class EnumValidationError extends Error {
  public statusCode: number;
  constructor(message: string) {
    super(message);
    this.name = 'EnumValidationError';
    this.statusCode = 400;
  }
}
