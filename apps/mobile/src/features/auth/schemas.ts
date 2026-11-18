import { z } from 'zod';

// Input validation at the boundary, strict objects, fail closed (plan section 9).
export const emailFormSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Escribe un correo válido.' })),
});

export const emailParamSchema = z.strictObject({
  email: z.email(),
});
