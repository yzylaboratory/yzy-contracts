import { z } from 'zod';

// Mirrors services/api/src/modules/auth/mod.rs (MeResponse). Responses are tolerant: unknown fields
// are ignored (zod strips them), while missing fields or wrong types fail closed (plan decision D3).
export const meSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  role: z.enum(['superadmin', 'member']),
  access: z.enum(['active', 'pending']),
  companies: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
    }),
  ),
  overdue_company_ids: z.array(z.uuid()),
  can_manage_billing: z.boolean(),
  billing_company_ids: z.array(z.uuid()),
  manageable_overdue_company_ids: z.array(z.uuid()),
});

export type MeParsed = z.infer<typeof meSchema>;
