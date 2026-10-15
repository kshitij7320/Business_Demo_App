import { ValidationError } from '../core/errors.js';

/**
 * Validates request body fields against presence, type, and custom validator functions.
 * @param {Record<string, { type?: string, required?: boolean, validate?: (val: any) => boolean|string }>} rules
 * @returns {import('express').RequestHandler}
 */
export function validateBody(rules) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next(new ValidationError('Request body must be a valid JSON object'));
    }

    const errors = [];

    for (const [field, spec] of Object.entries(rules)) {
      const val = req.body[field];

      if (spec.required && (val === undefined || val === null || val === '')) {
        errors.push(`Field "${field}" is required`);
        continue;
      }

      if (val !== undefined && val !== null) {
        if (spec.type && typeof val !== spec.type) {
          errors.push(`Field "${field}" must be of type ${spec.type}, got ${typeof val}`);
        } else if (spec.validate) {
          const customCheck = spec.validate(val);
          if (typeof customCheck === 'string') {
            errors.push(customCheck);
          } else if (customCheck === false) {
            errors.push(`Field "${field}" failed custom validation check`);
          }
        }
      }
    }

    if (errors.length > 0) {
      return next(new ValidationError(errors.join('; '), { errors }));
    }

    next();
  };
}
