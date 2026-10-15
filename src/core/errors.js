/**
 * Base application domain error.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   * @param {string} code
   * @param {Record<string, unknown>|null} details
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details
      }
    };
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource, id) {
    super(`${resource} with identifier "${id}" was not found`, 404, 'NOT_FOUND', { resource, id });
  }
}

export class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class InsufficientStockError extends AppError {
  /**
   * @param {string} skuCode
   * @param {number} requested
   * @param {number} available
   */
  constructor(skuCode, requested, available) {
    super(
      `Insufficient stock for SKU "${skuCode}". Requested: ${requested}, Available: ${available}`,
      422,
      'INSUFFICIENT_STOCK',
      { skuCode, requested, available, deficit: requested - available }
    );
  }
}

export class InvalidStateTransitionError extends AppError {
  /**
   * @param {string} entity
   * @param {string} from
   * @param {string} to
   */
  constructor(entity, from, to) {
    super(
      `Invalid state transition for ${entity}: cannot transition from "${from}" to "${to}"`,
      422,
      'INVALID_STATE_TRANSITION',
      { entity, from, to }
    );
  }
}

export class StorageCorruptionError extends AppError {
  constructor(message, details = null) {
    super(message, 500, 'STORAGE_CORRUPTION', details);
  }
}
