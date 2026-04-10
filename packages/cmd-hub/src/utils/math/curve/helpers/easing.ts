export type EasingFunction = (t: number) => number;

export const linearEasing: EasingFunction = (t) => t;
export const easeInQuad: EasingFunction = (t) => t * t;
export const easeOutQuad: EasingFunction = (t) => t * (2 - t);
