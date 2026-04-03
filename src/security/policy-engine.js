import { asArray, getPath } from "../common/object-path.js";

function normalizeToken(value) {
  return String(value).replaceAll("\\", "/").toLowerCase();
}

function shouldEvaluate(rule, envelope) {
  if (!rule.when) {
    return true;
  }

  return getPath(envelope, rule.when.path) === rule.when.eq;
}

function resolveRuleValue(rule, policy) {
  if (Object.hasOwn(rule, "value")) {
    return rule.value;
  }

  return getPath(policy, rule.value_from);
}

const operators = {
  in(actual, expected) {
    return asArray(expected).map(String).includes(String(actual));
  },
  lte(actual, expected) {
    return typeof actual === "number" && actual <= Number(expected);
  },
  eq(actual, expected) {
    return actual === expected;
  },
  paths_within(actual, expected) {
    const allowedRoots = asArray(expected).map(normalizeToken);
    return asArray(actual).every((value) =>
      allowedRoots.some((root) => normalizeToken(value).startsWith(root))
    );
  },
  not_contains_any(actual, expected) {
    const blocked = asArray(expected).map(normalizeToken);
    return asArray(actual).every(
      (value) =>
        !blocked.some((fragment) => normalizeToken(value).includes(fragment))
    );
  }
};

export class PolicyEngine {
  constructor(policy) {
    this.policy = policy;
  }

  evaluate(envelope) {
    const violations = [];

    for (const rule of asArray(this.policy.runtime_rules)) {
      if (!shouldEvaluate(rule, envelope)) {
        continue;
      }

      const actual = getPath(envelope, rule.field);
      const expected = resolveRuleValue(rule, this.policy);
      const operator = operators[rule.operator];

      if (!operator) {
        violations.push({
          rule_id: rule.id,
          message: `Unsupported policy operator: ${rule.operator}`
        });
        continue;
      }

      if (!operator(actual, expected)) {
        violations.push({
          rule_id: rule.id,
          field: rule.field,
          actual,
          expected,
          message: rule.message
        });
      }
    }

    return {
      allowed: violations.length === 0,
      violations
    };
  }
}
