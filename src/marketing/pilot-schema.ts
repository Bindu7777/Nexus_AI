import * as z from "zod";
import { pilotForm } from "./content";

// Shared by the form (client validation) and the API route (server validation).
export const pilotSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Please enter a valid work email."),
  company: z.string().trim().min(1, "Please enter your company.").max(160),
  role: z.string().trim().min(1, "Please enter your role.").max(120),
  teamSize: z.enum(pilotForm.teamSizes as [string, ...string[]], { message: "Please choose a team size." }),
  bugs: z.string().trim().max(2000, "Please keep this under 2,000 characters.").optional().default(""),
  // Honeypot: real visitors never see or fill this field.
  website: z.string().max(0).optional().default(""),
});

export type PilotRequest = z.infer<typeof pilotSchema>;
