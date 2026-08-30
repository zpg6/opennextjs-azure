/**
 * Validation for values that get interpolated into `az` shell commands.
 *
 * These values come from CLI flags, prompts, and azure.config.json, which
 * may arrive in a cloned repo. Every az invocation in this package builds a
 * shell string, so anything outside Azure's own naming rules is rejected
 * before it reaches the shell.
 */

const RULES: Record<string, { pattern: RegExp; hint: string }> = {
    appName: {
        pattern: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,58}[a-zA-Z0-9]$/,
        hint: "2-60 alphanumeric characters or hyphens, starting and ending with an alphanumeric",
    },
    resourceGroup: {
        pattern: /^[a-zA-Z0-9_()\-.]{1,90}$/,
        hint: "1-90 alphanumerics, underscores, parentheses, hyphens, or periods",
    },
    location: {
        pattern: /^[a-z0-9]{3,30}$/,
        hint: "a lowercase Azure region name like eastus or westeurope",
    },
    environment: {
        pattern: /^(dev|staging|prod)$/,
        hint: "one of: dev, staging, prod",
    },
};

export function validateAzureName(kind: keyof typeof RULES, value: string | undefined): void {
    if (value === undefined) return;
    const rule = RULES[kind];
    if (!rule.pattern.test(value)) {
        console.error(`❌ Invalid ${kind}: ${JSON.stringify(value)}`);
        console.error(`   Expected ${rule.hint}.`);
        process.exit(1);
    }
}

export function validateAzureNames(values: {
    appName?: string;
    resourceGroup?: string;
    location?: string;
    environment?: string;
}): void {
    validateAzureName("appName", values.appName);
    validateAzureName("resourceGroup", values.resourceGroup);
    validateAzureName("location", values.location);
    validateAzureName("environment", values.environment);
}
