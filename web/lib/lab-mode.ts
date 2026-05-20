/** When false (production default), the site is portfolio-only — lab UI is a non-executing preview. */
export const isLabLive = process.env.NEXT_PUBLIC_LAB_ENABLED === "true";

export const labModeLabel = isLabLive ? "Live lab" : "Lab demo";
