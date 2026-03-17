const MONTH_ALIASES = Object.freeze({
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
});

const DAY_OF_WEEK_ALIASES = Object.freeze({
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
});

function coerceDate(value, label) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`${label} must be a valid date.`);
    }
    return new Date(value.getTime());
  }
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid date.`);
  }
  return date;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseFieldValue(value, label, min, max, aliases = null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) {
    throw new Error(`${label} contains an empty value.`);
  }

  let parsedValue = null;
  if (/^\d+$/.test(normalized)) {
    parsedValue = Number(normalized);
  } else if (aliases && Object.hasOwn(aliases, normalized)) {
    parsedValue = aliases[normalized];
  }

  if (!Number.isInteger(parsedValue) || parsedValue < min || parsedValue > max) {
    throw new Error(
      `${label} value "${value}" must be between ${min} and ${max}.`,
    );
  }

  return parsedValue;
}

function expandFieldPart(part, label, min, max, aliases = null) {
  const trimmed = String(part ?? "").trim();
  if (!trimmed) {
    throw new Error(`${label} contains an empty list entry.`);
  }

  const [rangeSpec, stepSpec, extraStep] = trimmed.split("/");
  if (extraStep !== undefined) {
    throw new Error(`${label} contains too many "/" step delimiters.`);
  }

  const step = stepSpec === undefined ? 1 : parsePositiveInteger(stepSpec, label);
  let start = min;
  let end = max;

  if (rangeSpec !== "*") {
    const [startSpec, endSpec, extraRange] = rangeSpec.split("-");
    if (extraRange !== undefined) {
      throw new Error(`${label} contains too many "-" range delimiters.`);
    }
    start = parseFieldValue(startSpec, label, min, max, aliases);
    end =
      endSpec === undefined
        ? start
        : parseFieldValue(endSpec, label, min, max, aliases);
    if (end < start) {
      throw new Error(`${label} range "${rangeSpec}" is reversed.`);
    }
  }

  const values = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function buildValueSet(field, label, min, max, aliases = null) {
  const values = new Set();
  for (const part of String(field ?? "").split(",")) {
    for (const value of expandFieldPart(part, label, min, max, aliases)) {
      values.add(value);
    }
  }
  return values;
}

function sortNumeric(values) {
  return Array.from(values).sort((left, right) => left - right);
}

function normalizeDayOfWeekValues(values) {
  const normalized = new Set();
  for (const value of values) {
    normalized.add(value === 7 ? 0 : value);
  }
  return normalized;
}

function buildFullValueSet(min, max, normalize = (values) => values) {
  const values = new Set();
  for (let value = min; value <= max; value += 1) {
    values.add(value);
  }
  return normalize(values);
}

function buildCronField(name, source, min, max, aliases = null, normalize = null) {
  const rawValues = buildValueSet(source, name, min, max, aliases);
  const normalizedValues = normalize ? normalize(rawValues) : rawValues;
  const fullDomain = buildFullValueSet(min, max, normalize ?? ((values) => values));
  return {
    source: String(source ?? "").trim(),
    values: sortNumeric(normalizedValues),
    hasWildcard: normalizedValues.size === fullDomain.size,
  };
}

function normalizeCronInput(expressionOrSchedule) {
  if (
    expressionOrSchedule &&
    typeof expressionOrSchedule === "object" &&
    !Array.isArray(expressionOrSchedule) &&
    typeof expressionOrSchedule.expression === "string" &&
    expressionOrSchedule.minute &&
    expressionOrSchedule.hour &&
    expressionOrSchedule.dayOfMonth &&
    expressionOrSchedule.month &&
    expressionOrSchedule.dayOfWeek
  ) {
    return expressionOrSchedule;
  }
  return parseCronExpression(expressionOrSchedule);
}

export function parseCronExpression(expression) {
  const normalized = String(expression ?? "").trim();
  if (!normalized) {
    throw new Error("Cron expression is required.");
  }

  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      "Cron expression must contain exactly 5 fields: minute hour day-of-month month day-of-week.",
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    expression: normalized,
    minute: buildCronField("minute", minute, 0, 59),
    hour: buildCronField("hour", hour, 0, 23),
    dayOfMonth: buildCronField("day-of-month", dayOfMonth, 1, 31),
    month: buildCronField("month", month, 1, 12, MONTH_ALIASES),
    dayOfWeek: buildCronField(
      "day-of-week",
      dayOfWeek,
      0,
      7,
      DAY_OF_WEEK_ALIASES,
      normalizeDayOfWeekValues,
    ),
  };
}

export function matchesCronExpression(expressionOrSchedule, date = Date.now()) {
  const schedule = normalizeCronInput(expressionOrSchedule);
  const candidate = coerceDate(date, "Cron candidate date");
  const minute = candidate.getMinutes();
  const hour = candidate.getHours();
  const dayOfMonth = candidate.getDate();
  const month = candidate.getMonth() + 1;
  const dayOfWeek = candidate.getDay();

  if (!schedule.minute.values.includes(minute)) {
    return false;
  }
  if (!schedule.hour.values.includes(hour)) {
    return false;
  }
  if (!schedule.month.values.includes(month)) {
    return false;
  }

  const dayOfMonthMatches = schedule.dayOfMonth.values.includes(dayOfMonth);
  const dayOfWeekMatches = schedule.dayOfWeek.values.includes(dayOfWeek);

  if (!schedule.dayOfMonth.hasWildcard && !schedule.dayOfWeek.hasWildcard) {
    return dayOfMonthMatches || dayOfWeekMatches;
  }
  if (!schedule.dayOfMonth.hasWildcard) {
    return dayOfMonthMatches;
  }
  if (!schedule.dayOfWeek.hasWildcard) {
    return dayOfWeekMatches;
  }
  return true;
}

export function nextCronOccurrence(expressionOrSchedule, from = Date.now()) {
  const schedule = normalizeCronInput(expressionOrSchedule);
  const cursor = coerceDate(from, "Cron start date");
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxIterations = 60 * 24 * 366 * 5;
  for (let index = 0; index < maxIterations; index += 1) {
    if (matchesCronExpression(schedule, cursor)) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  throw new Error(
    `No cron occurrence found for "${schedule.expression}" within the next 5 years.`,
  );
}
