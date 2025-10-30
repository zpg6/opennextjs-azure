const colors = {
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    reset: "\x1b[0m",
};

export function greenCheck(): string {
    return `${colors.green}✓${colors.reset}`;
}

export function redX(): string {
    return `${colors.red}✗${colors.reset}`;
}

export function yellowWarning(): string {
    return `${colors.yellow}⚠${colors.reset}`;
}
