import { z } from "zod";
export const auditInput = z.object({
  url: z.string().trim().url().max(2048),
  country: z.enum([
    "United States",
    "United Kingdom",
    "Israel",
    "Saudi Arabia",
    "United Arab Emirates",
    "Germany",
  ]),
  language: z.enum(["English", "Arabic", "Hebrew", "German"]),
  device: z.enum(["Mobile", "Desktop"]),
  maxPages: z.number().int().min(0).max(10000),
  keywords: z.array(z.string().trim().min(1).max(120)).max(200),
  authorized: z.literal(true),
});
